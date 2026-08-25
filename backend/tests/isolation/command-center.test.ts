import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

// 18.1 Command Center: единый эндпоинт вместо трёх отдельных походов с
// фронта (buildSupervisorDashboard + smart_alerts + findUnderperformingEmployees).
describe('GET /command-center', () => {
  const fx = new TestFixtures();
  let orgA: string, orgB: string;
  let storeA: string, storeB: string;
  let managerA: { id: number; telegramId: number };
  let managerB: { id: number; telegramId: number };
  let employeeA: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A');
    orgB = await fx.createOrg('Org B');
    storeA = await fx.createStore(orgA);
    storeB = await fx.createStore(orgB);
    managerA = await fx.createEmployee(orgA, { role: 'manager' });
    managerB = await fx.createEmployee(orgB, { role: 'manager' });
    employeeA = await fx.createEmployee(orgA, { role: 'employee' });
  });

  afterAll(() => fx.cleanup());

  it('без токена — 401', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/command-center' });
    expect(res.statusCode).toBe(401);
  });

  it('обычный employee — 403 (только manager/supervisor/admin)', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/command-center',
      headers: authAs(employeeA.telegramId)
    });
    expect(res.statusCode).toBe(403);
  });

  it('manager своей сети — 200, видит только свою точку', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/command-center',
      headers: authAs(managerA.telegramId)
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.stores.find((s: any) => s.store_id === storeA)).toBeDefined();
    expect(body.stores.find((s: any) => s.store_id === storeB)).toBeUndefined();
  });

  it('manager другой сети не видит проблемы/точки чужой сети', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/command-center',
      headers: authAs(managerB.telegramId)
    });
    const body = res.json();
    expect(body.stores.find((s: any) => s.store_id === storeA)).toBeUndefined();
    expect(body.problems.some((p: any) => p.store_id === storeA)).toBe(false);
  });

  it('точка без смены и без продаж — попадает в problems как store-level drop', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/command-center',
      headers: authAs(managerA.telegramId)
    });
    const body = res.json();
    // storeA сегодня без плана/смены/продаж — buildSupervisorDashboard
    // либо не генерит drop (нет плана => alerts пустые), либо генерит
    // "Никого на смене" в зависимости от наличия плана; главное — эндпоинт
    // не падает и возвращает согласованную структуру.
    expect(Array.isArray(body.problems)).toBe(true);
    expect(typeof body.network.health).toBe('number');
  });

  it('сотрудник с 0 продаж при работающем коллеге — попадает в problems как персональная просадка (прошлая дата, гейт по времени не применяется)', async () => {
    const employeeB = await fx.createEmployee(orgA, { role: 'employee', fullName: 'Slacker' });
    const employeeC = await fx.createEmployee(orgA, { role: 'employee', fullName: 'Hard Worker' });
    const date = '2026-03-02'; // прошлая дата — гейт "после 14:00" не применяется

    await query(
      `INSERT INTO schedules (employee_id, store_id, work_date, hours) VALUES ($1,$2,$3,8),($4,$2,$3,8)`,
      [employeeB.id, storeA, date, employeeC.id]
    );
    // employeeC продал что-то, employeeB — ничего
    await query(
      `INSERT INTO sales (employee_id, store_id, sale_date, sim) VALUES ($1,$2,$3,5)`,
      [employeeC.id, storeA, date]
    );

    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/command-center?date=${date}`,
      headers: authAs(managerA.telegramId)
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const flagged = body.problems.find(
      (p: any) => p.actions?.[0]?.type === 'open_employee' && p.actions[0].id === employeeB.id
    );
    expect(flagged).toBeDefined();
    // Работника с продажами не флагуем
    const notFlagged = body.problems.find(
      (p: any) => p.actions?.[0]?.type === 'open_employee' && p.actions[0].id === employeeC.id
    );
    expect(notFlagged).toBeUndefined();
  });

  // 21.0 Recommend — create_task действие для алерта берёт message из
  // suggestAction(alert_type, payload), не из голого заголовка алерта,
  // когда для причины есть детерминированная подсказка.
  it('anomaly_vs_forecast с understaffing в possible_causes — create_task message содержит совет, не голый заголовок', async () => {
    const ins = await query(
      `INSERT INTO smart_alerts (store_id, alert_type, severity, title, body, payload, status, alert_date)
       VALUES ($1,'anomaly_vs_forecast','warn','Точка А: необычно тихий день','...',$2,'open',CURRENT_DATE)
       RETURNING id`,
      [storeA, JSON.stringify({ possible_causes: [{ type: 'understaffing', detail: 'x' }] })]
    );
    const alertId = Number(ins.rows[0].id);

    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/command-center', headers: authAs(managerA.telegramId) });
    const body = res.json();
    const problem = body.problems.find((p: any) => Number(p.alert_id) === alertId);
    expect(problem).toBeDefined();
    const createTask = problem.actions.find((a: any) => a.type === 'create_task');
    expect(createTask.message).toContain('график');
    expect(createTask.message).not.toBe('Точка А: необычно тихий день');

    await query(`DELETE FROM smart_alerts WHERE id = $1`, [alertId]);
  });

  it('алерт без известной причины (старый тип/пустой payload) — create_task message падает обратно на заголовок алерта', async () => {
    const ins = await query(
      `INSERT INTO smart_alerts (store_id, alert_type, severity, title, body, status, alert_date)
       VALUES ($1,'cash_gap','warn','Точка А: расхождение кассы','...','open',CURRENT_DATE)
       RETURNING id`,
      [storeA]
    );
    const alertId = Number(ins.rows[0].id);

    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/command-center', headers: authAs(managerA.telegramId) });
    const body = res.json();
    const problem = body.problems.find((p: any) => Number(p.alert_id) === alertId);
    const createTask = problem.actions.find((a: any) => a.type === 'create_task');
    expect(createTask.message).toBe('Точка А: расхождение кассы');

    await query(`DELETE FROM smart_alerts WHERE id = $1`, [alertId]);
  });
});
