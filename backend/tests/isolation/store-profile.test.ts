import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/db/index.js';
import { todayMoscow } from '../../src/utils/date.js';

// 18.5 Store Intelligence — профиль точки + объяснимый Store Health Score.
// Conversion/Avg check намеренно не считаются (нет данных о трафике/деньгах,
// см. план) — компоненты здесь только план/тренд/staffing/касса.
describe('GET /stores/:id/profile', () => {
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

    // Полная стаффинг-покрытость и чистая касса за последние 7 дней (days=7).
    // Считаем даты в МСК (todayMoscow), тем же способом, что и бэкенд —
    // иначе на границе суток тестовый диапазон может разъехаться с тем,
    // что роут считает "сегодня", и покрытие окажется не 100%, а 6/7.
    const todayStr0 = todayMoscow();
    for (let i = 0; i < 7; i++) {
      const d = new Date(todayStr0 + 'T12:00:00');
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      await query(
        `INSERT INTO schedules (employee_id, store_id, work_date, hours) VALUES ($1,$2,$3,8)`,
        [employeeA.id, storeA, dateStr]
      );
      await query(
        `INSERT INTO store_cash (store_id, cash_date, cash_fact, cash_1c) VALUES ($1,$2,$3,$3)`,
        [storeA, dateStr, 10000]
      );
      await query(
        `INSERT INTO sales (employee_id, store_id, sale_date, sim, mnp, pa, combo) VALUES ($1,$2,$3,2,1,1,1)`,
        [employeeA.id, storeA, dateStr]
      );
    }
  });

  afterAll(async () => {
    await query(`DELETE FROM store_cash WHERE store_id = $1`, [storeA]);
    await fx.cleanup();
  });

  it('без токена — 401', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: `/stores/${storeA}/profile` });
    expect(res.statusCode).toBe(401);
  });

  it('manager другой сети получает 403', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/stores/${storeA}/profile`,
      headers: authAs(managerB.telegramId)
    });
    expect(res.statusCode).toBe(403);
  });

  it('manager своей сети получает профиль с разбивкой Health Score', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/stores/${storeA}/profile?days=7`,
      headers: authAs(managerA.telegramId)
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.store.store_id).toBe(storeA);
    expect(typeof body.health.score).toBe('number');
    expect(body.health.score).toBeGreaterThanOrEqual(0);
    expect(body.health.score).toBeLessThanOrEqual(100);

    // Полное покрытие штатом и чистая касса за весь период -> обе
    // компоненты должны быть 100.
    expect(body.health.components.staffing.value).toBe(100);
    expect(body.health.components.cash_discipline.value).toBe(100);
    // Веса компонент в сумме дают 1 — проверяем, что Health Score
    // действительно объяснимая композиция, а не произвольное число.
    const weightSum = Object.values(body.health.components).reduce(
      (s: number, c: any) => s + c.weight, 0
    );
    expect(weightSum).toBeCloseTo(1, 5);
  });

  it('несуществующая точка своей сети — 403 (не проходит org-check раньше 404)', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/stores/does_not_exist/profile`,
      headers: authAs(managerA.telegramId)
    });
    expect(res.statusCode).toBe(403);
  });

  it('conversion/avg check не присутствуют в ответе — честно не выдумываем', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/stores/${storeA}/profile?days=7`,
      headers: authAs(managerA.telegramId)
    });
    const body = res.json();
    expect(body.health.components.conversion).toBeUndefined();
    expect(body.health.components.avg_check).toBeUndefined();
  });

  // Регрессия: buildSupervisorDashboard() строила trend с ключом
  // String(pgDateObject).slice(0,10) — на JS Date-объекте это даёт
  // "Tue Aug 11", не "2026-08-11", и никогда не совпадало с ключом
  // cursor.toISOString() в цикле заполнения — trend был ВСЕГДА пустым
  // массивом нулей, для любой точки, с тех пор как эта функция появилась
  // (supervisor-кабинет использует тот же trend для sparkline — был
  // сломан молча). Найдено при живой проверке Store Intelligence.
  it('trend отражает реально внесённые продажи, а не одни нули', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/stores/${storeA}/profile?days=7`,
      headers: authAs(managerA.telegramId)
    });
    const body = res.json();
    expect(Array.isArray(body.trend)).toBe(true);
    const nonZeroDays = body.trend.filter((t: any) => (t.units || 0) > 0);
    expect(nonZeroDays.length).toBeGreaterThan(0);
    // 2 sim + 1 mnp + 1 pa + 1 combo = 5 юнитов в день, семь дней подряд.
    expect(nonZeroDays.every((t: any) => t.units === 5)).toBe(true);
  });
});
