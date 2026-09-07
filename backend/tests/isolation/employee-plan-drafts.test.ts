/**
 * Автоматический расчёт персональных месячных планов (миграция 0029,
 * core/plans/employee-plan-generator.ts) — покрываем то, что не проверяется
 * штатными /plans/* тестами: мультитенантность источников истории/fallback,
 * блокировку stale-черновика, точность round-трипа (largest remainder) и
 * распределение вклада сотрудника, работающего на двух точках одной сети.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import {
  generateDraft, applyDraft, viewDraft, defaultTargetMonth, StaleDraftError, DraftHasBlockingErrorsError
} from '../../src/core/plans/employee-plan-generator.js';

function monthAdd(monthStartIso: string, delta: number): string {
  const [y, m] = monthStartIso.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}

describe('Автоматический расчёт персональных планов (draft/apply)', () => {
  const fx = new TestFixtures();
  const draftIds: number[] = [];

  const target = defaultTargetMonth();
  const hist1 = monthAdd(target, -2); // самый свежий полный месяц (вес 0.5)
  const hist2 = monthAdd(target, -3); // вес 0.3
  const hist3 = monthAdd(target, -4); // вес 0.2

  async function setStorePlan(storeId: string, month: string, sim: number, phones: number) {
    await query(
      `INSERT INTO store_month_plans (store_id, month, sim, phones) VALUES ($1, $2, $3, $4)
       ON CONFLICT (store_id, month) DO UPDATE SET sim = EXCLUDED.sim, phones = EXCLUDED.phones`,
      [storeId, month, sim, phones]
    );
  }

  async function addSchedule(employeeId: number, storeId: string, dates: string[]) {
    for (const d of dates) {
      await query(
        `INSERT INTO schedules (employee_id, store_id, work_date, hours) VALUES ($1, $2, $3, 8)`,
        [employeeId, storeId, d]
      );
    }
  }

  async function addSales(employeeId: number, storeId: string, date: string, sim: number, phones: number) {
    await query(
      `INSERT INTO sales (employee_id, store_id, sale_date, sim, phones) VALUES ($1, $2, $3, $4, $5)`,
      [employeeId, storeId, date, sim, phones]
    );
  }

  afterAll(async () => {
    if (draftIds.length) {
      await query(`DELETE FROM employee_month_plan_drafts WHERE id = ANY($1)`, [draftIds]);
    }
    if (fx.employeeIds.length) {
      await query(`DELETE FROM employee_month_plans WHERE employee_id = ANY($1)`, [fx.employeeIds]);
    }
    if (fx.storeIds.length) {
      await query(`DELETE FROM store_month_plans WHERE store_id = ANY($1)`, [fx.storeIds]);
    }
    await fx.cleanup();
  });

  it('мультитенантность: история/org_avg-фоллбэк другой сети никогда не влияет на расчёт', async () => {
    const orgA = await fx.createOrg('Plan Gen Org A');
    const orgB = await fx.createOrg('Plan Gen Org B');
    const storeA = await fx.createStore(orgA, 'Store A');
    const storeA2 = await fx.createStore(orgA, 'Store A2'); // без истории вообще — форсирует org_avg
    const storeB = await fx.createStore(orgB, 'Store B');
    const managerA = await fx.createEmployee(orgA, { role: 'manager' });
    const empA = await fx.createEmployee(orgA, { role: 'employee', fullName: 'Employee A' });
    const empA2 = await fx.createEmployee(orgA, { role: 'employee', fullName: 'Employee A2 (org_avg)' });
    const empB = await fx.createEmployee(orgB, { role: 'employee', fullName: 'Employee B' });

    // История: сотрудник A — 10 sim за 10 смен (продуктивность 1/смену) в
    // каждом из 3 полных месяцев; сотрудник B (чужая сеть) — 1000 sim за
    // 10 смен (продуктивность 100/смену) — если бы изоляция сломалась, это
    // огромное число просочилось бы в org_avg-фоллбэк сети A.
    for (const m of [hist1, hist2, hist3]) {
      await addSchedule(empA.id, storeA, [`${m.slice(0, 8)}05`, `${m.slice(0, 8)}06`]);
      await addSales(empA.id, storeA, `${m.slice(0, 8)}05`, 1, 0);
      await addSales(empA.id, storeA, `${m.slice(0, 8)}06`, 1, 0);
      await addSchedule(empB.id, storeB, [`${m.slice(0, 8)}05`]);
      await addSales(empB.id, storeB, `${m.slice(0, 8)}05`, 1000, 0);
    }

    await setStorePlan(storeA, target, 10, 0);
    await setStorePlan(storeA2, target, 4, 0);
    await setStorePlan(storeB, target, 10, 0);
    await addSchedule(empA.id, storeA, [`${target.slice(0, 8)}10`]);
    // empA2 работает будущей месяц на storeA2, у которой нет ни своей, ни
    // сотруднической истории вообще -> вынужден упасть до org_avg сети A,
    // который считается ТОЛЬКО по storeA/empA этой сети (1 sim/смену), а не
    // по storeB/empB (100 sim/смену) чужой сети.
    await addSchedule(empA2.id, storeA2, [`${target.slice(0, 8)}10`]);
    await addSchedule(empB.id, storeB, [`${target.slice(0, 8)}10`]);

    const result = await generateDraft(orgA, target, managerA.id);
    draftIds.push(result.draft.id);

    expect(result.blocking_errors).toEqual([]);
    const item = result.items.find((it) => Number(it.employee_id) === empA.id);
    expect(item).toBeDefined();
    // Продуктивность A = 1 sim/смену (2 sim / 2 смены каждый месяц) — не 100,
    // как было бы, если бы данные B протекли в её расчёт.
    expect(item!.by_store[0].productivity.sim).toBeCloseTo(1, 6);
    expect(item!.final_plan.sim).toBe(10);

    const item2 = result.items.find((it) => Number(it.employee_id) === empA2.id);
    expect(item2).toBeDefined();
    expect(item2!.by_store[0].tier).toBe('org_avg');
    // org_avg сети A = 1 sim/смену (только storeA/empA) — не ~50 (среднее
    // между 1 и 100), что было бы, если бы orgB просочилась в агрегат.
    expect(item2!.by_store[0].productivity.sim).toBeCloseTo(1, 6);
    expect(item2!.final_plan.sim).toBe(4);

    // Сотрудник другой сети вообще не должен появиться в черновике сети A.
    expect(result.items.find((it) => Number(it.employee_id) === empB.id)).toBeUndefined();
  });

  it('блокирующая валидация: план точки > 0, но 0 будущих смен', async () => {
    const org = await fx.createOrg('Plan Gen Blocking Org');
    const store = await fx.createStore(org, 'Blocking Store');
    const manager = await fx.createEmployee(org, { role: 'manager' });

    await setStorePlan(store, target, 50, 0);
    // Намеренно НЕ создаём расписание на target-месяц для этой точки.

    const result = await generateDraft(org, target, manager.id);
    draftIds.push(result.draft.id);

    expect(result.blocking_errors.length).toBe(1);
    expect(result.blocking_errors[0].store_id).toBe(store);

    await expect(applyDraft(result.draft.id, org, manager.id)).rejects.toBeInstanceOf(DraftHasBlockingErrorsError);
  });

  it('largest-remainder округление: сумма планов сотрудников точно равна плану точки (count и money)', async () => {
    const org = await fx.createOrg('Plan Gen Rounding Org');
    const store = await fx.createStore(org, 'Rounding Store');
    const manager = await fx.createEmployee(org, { role: 'manager' });
    const e1 = await fx.createEmployee(org, { role: 'employee', fullName: 'R1' });
    const e2 = await fx.createEmployee(org, { role: 'employee', fullName: 'R2' });
    const e3 = await fx.createEmployee(org, { role: 'employee', fullName: 'R3' });

    // Неравная история продуктивности -> доли не делятся ровно на план (10 sim / 100 phones).
    for (const m of [hist1, hist2, hist3]) {
      await addSchedule(e1.id, store, [`${m.slice(0, 8)}05`]);
      await addSales(e1.id, store, `${m.slice(0, 8)}05`, 1, 10);
      await addSchedule(e2.id, store, [`${m.slice(0, 8)}05`]);
      await addSales(e2.id, store, `${m.slice(0, 8)}05`, 1, 7);
      await addSchedule(e3.id, store, [`${m.slice(0, 8)}05`]);
      await addSales(e3.id, store, `${m.slice(0, 8)}05`, 1, 3);
    }

    await setStorePlan(store, target, 10, 100);
    await addSchedule(e1.id, store, [`${target.slice(0, 8)}10`]);
    await addSchedule(e2.id, store, [`${target.slice(0, 8)}10`]);
    await addSchedule(e3.id, store, [`${target.slice(0, 8)}10`]);

    const result = await generateDraft(org, target, manager.id);
    draftIds.push(result.draft.id);

    const simSum = result.items.reduce((a, it) => a + (it.final_plan.sim || 0), 0);
    const phonesSum = result.items.reduce((a, it) => a + (it.final_plan.phones || 0), 0);
    expect(simSum).toBe(10);
    expect(Math.round(phonesSum * 100) / 100).toBe(100);
    // sim (count) — только целые значения.
    for (const it of result.items) expect(Number.isInteger(it.final_plan.sim)).toBe(true);
    // phones (money) — не более 2 знаков после запятой.
    for (const it of result.items) {
      const cents = Math.round((it.final_plan.phones || 0) * 100);
      expect(cents / 100).toBeCloseTo(it.final_plan.phones || 0, 9);
    }
  });

  it('сотрудник на двух точках: вклад считается и нормализуется отдельно по каждой точке', async () => {
    const org = await fx.createOrg('Plan Gen MultiStore Org');
    const storeX = await fx.createStore(org, 'Store X');
    const storeY = await fx.createStore(org, 'Store Y');
    const manager = await fx.createEmployee(org, { role: 'manager' });
    const multi = await fx.createEmployee(org, { role: 'employee', fullName: 'Multi Store Employee' });
    const soloX = await fx.createEmployee(org, { role: 'employee', fullName: 'Solo X' });

    for (const m of [hist1, hist2, hist3]) {
      // multi: 1 смена на X (продукт. 2 sim/смену), 1 смена на Y (продукт. 4 sim/смену)
      await addSchedule(multi.id, storeX, [`${m.slice(0, 8)}05`]);
      await addSales(multi.id, storeX, `${m.slice(0, 8)}05`, 2, 0);
      await addSchedule(multi.id, storeY, [`${m.slice(0, 8)}06`]);
      await addSales(multi.id, storeY, `${m.slice(0, 8)}06`, 4, 0);
      // soloX: 1 смена на X, продукт. 2 sim/смену — идентична multi на X.
      await addSchedule(soloX.id, storeX, [`${m.slice(0, 8)}07`]);
      await addSales(soloX.id, storeX, `${m.slice(0, 8)}07`, 2, 0);
    }

    await setStorePlan(storeX, target, 20, 0); // multi и soloX — равный вклад -> 10/10
    await setStorePlan(storeY, target, 40, 0); // только multi -> весь план ей

    await addSchedule(multi.id, storeX, [`${target.slice(0, 8)}10`]);
    await addSchedule(multi.id, storeY, [`${target.slice(0, 8)}11`]);
    await addSchedule(soloX.id, storeX, [`${target.slice(0, 8)}10`]);

    const result = await generateDraft(org, target, manager.id);
    draftIds.push(result.draft.id);

    const multiItem = result.items.find((it) => Number(it.employee_id) === multi.id)!;
    const soloItem = result.items.find((it) => Number(it.employee_id) === soloX.id)!;
    expect(multiItem.by_store.length).toBe(2);
    const bx = multiItem.by_store.find((b) => b.store_id === storeX)!;
    const by = multiItem.by_store.find((b) => b.store_id === storeY)!;
    expect(bx.final_plan.sim).toBe(10); // равная продуктивность на X -> ровно половина плана X
    expect(by.final_plan.sim).toBe(40); // единственный участник на Y -> весь план Y
    expect(soloItem.final_plan.sim).toBe(10);
    // Итоговый план сотрудника — сумма нормализованных долей по обеим точкам.
    expect(multiItem.final_plan.sim).toBe(bx.final_plan.sim + by.final_plan.sim);
    expect(multiItem.final_plan.sim).toBe(50);
  });

  it('stale draft: изменение расписания после генерации блокирует apply с 409, повторная генерация снова применима', async () => {
    const org = await fx.createOrg('Plan Gen Stale Org');
    const store = await fx.createStore(org, 'Stale Store');
    const manager = await fx.createEmployee(org, { role: 'manager' });
    const emp = await fx.createEmployee(org, { role: 'employee', fullName: 'Stale Employee' });

    for (const m of [hist1, hist2, hist3]) {
      await addSchedule(emp.id, store, [`${m.slice(0, 8)}05`]);
      await addSales(emp.id, store, `${m.slice(0, 8)}05`, 1, 0);
    }
    await setStorePlan(store, target, 5, 0);
    await addSchedule(emp.id, store, [`${target.slice(0, 8)}10`]);

    const result = await generateDraft(org, target, manager.id);
    draftIds.push(result.draft.id);

    // Расписание меняется ПОСЛЕ генерации черновика -> fingerprint расходится.
    await addSchedule(emp.id, store, [`${target.slice(0, 8)}11`]);

    await expect(applyDraft(result.draft.id, org, manager.id)).rejects.toBeInstanceOf(StaleDraftError);

    const staleView = await viewDraft(result.draft.id, org);
    expect(staleView!.draft.status).toBe('stale');

    // Пересчёт после изменения -> новый черновик снова применим и идемпотентен.
    const fresh = await generateDraft(org, target, manager.id);
    draftIds.push(fresh.draft.id);
    expect(fresh.blocking_errors).toEqual([]);

    const applied1 = await applyDraft(fresh.draft.id, org, manager.id);
    expect(applied1.applied).toBe(true);
    expect(applied1.draft.status).toBe('applied');

    // Повторный apply того же уже применённого черновика — идемпотентный no-op.
    const applied2 = await applyDraft(fresh.draft.id, org, manager.id);
    expect(applied2.applied).toBe(false);
    expect(applied2.draft.status).toBe('applied');

    const planRow = await query(
      `SELECT sim FROM employee_month_plans WHERE employee_id = $1 AND month = $2`,
      [emp.id, target]
    );
    expect(Number(planRow.rows[0].sim)).toBe(5);
  });

  it('API: POST /plans/employees/month-drafts генерирует, GET /latest и /:id читают, POST /apply применяет', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Plan Gen API Org');
    const store = await fx.createStore(org, 'API Store');
    const manager = await fx.createEmployee(org, { role: 'manager' });
    const emp = await fx.createEmployee(org, { role: 'employee', fullName: 'API Employee' });

    for (const m of [hist1, hist2, hist3]) {
      await addSchedule(emp.id, store, [`${m.slice(0, 8)}05`]);
      await addSales(emp.id, store, `${m.slice(0, 8)}05`, 1, 0);
    }
    await setStorePlan(store, target, 3, 0);
    await addSchedule(emp.id, store, [`${target.slice(0, 8)}10`]);

    const genRes = await app.inject({
      method: 'POST', url: '/plans/employees/month-drafts',
      headers: { ...authAs(manager.telegramId), 'content-type': 'application/json' },
      payload: { month: target }
    });
    expect(genRes.statusCode).toBe(200);
    const genBody = genRes.json();
    draftIds.push(genBody.draft_id);
    expect(genBody.blocking_errors).toEqual([]);

    const latestRes = await app.inject({
      method: 'GET', url: `/plans/employees/month-drafts/latest?month=${target}`,
      headers: authAs(manager.telegramId)
    });
    expect(latestRes.statusCode).toBe(200);
    expect(latestRes.json().draft.id).toBe(genBody.draft_id);

    const byIdRes = await app.inject({
      method: 'GET', url: `/plans/employees/month-drafts/${genBody.draft_id}`,
      headers: authAs(manager.telegramId)
    });
    expect(byIdRes.statusCode).toBe(200);

    const applyRes = await app.inject({
      method: 'POST', url: `/plans/employees/month-drafts/${genBody.draft_id}/apply`,
      headers: { ...authAs(manager.telegramId), 'content-type': 'application/json' },
      payload: {}
    });
    expect(applyRes.statusCode).toBe(200);
    expect(applyRes.json().applied).toBe(true);
  });
});
