import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import { todayMoscow } from '../../src/utils/date.js';

describe('Изоляция планов (/plans/employees/month, /plans/stores/daily, /plans/stores/:id/month)', () => {
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
    employeeA = await fx.createEmployee(orgA, { role: 'employee', fullName: 'Plans Employee A' });
  });

  afterAll(() => fx.cleanup());

  it('GET /plans/employees/month — своя сеть не видит сотрудников другой сети', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/plans/employees/month', headers: authAs(managerB.telegramId) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rows.find((r: any) => Number(r.employee_id) === employeeA.id)).toBeUndefined();
  });

  it('GET /plans/employees/month — своя сеть видна целиком', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/plans/employees/month', headers: authAs(managerA.telegramId) });
    const body = res.json();
    expect(body.rows.find((r: any) => Number(r.employee_id) === employeeA.id)).toBeDefined();
  });

  it('GET /plans/stores/daily — только точки своей сети', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/plans/stores/daily', headers: authAs(managerA.telegramId) });
    const body = res.json();
    expect(body.stores.find((s: any) => s.store_id === storeA)).toBeDefined();
    expect(body.stores.find((s: any) => s.store_id === storeB)).toBeUndefined();
  });

  it('PUT /plans/stores/:id/month — 403 на точке чужой сети', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/plans/stores/${storeB}/month`,
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { sim: 100 }
    });
    expect(res.statusCode).toBe(403);
  });

  it('PUT /plans/stores/:id/month — проходит на своей точке', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/plans/stores/${storeA}/month`,
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { sim: 100 }
    });
    expect(res.statusCode).toBe(200);
  });

  // Регрессия: оба раньше были без проверки сети — GET вообще без
  // авторизации (план любого сотрудника любой сети был виден по id кому
  // угодно), PUT позволял manager чужой сети задать план любому сотруднику.
  it('GET /plans/employees/:id/month — чужая сеть получает 403', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/plans/employees/${employeeA.id}/month`,
      headers: authAs(managerB.telegramId)
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET /plans/employees/:id/month — без токена вообще — 401', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: `/plans/employees/${employeeA.id}/month` });
    expect(res.statusCode).toBe(401);
  });

  it('GET /plans/employees/:id/month — своя сеть может смотреть', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/plans/employees/${employeeA.id}/month`,
      headers: authAs(managerA.telegramId)
    });
    expect(res.statusCode).toBe(200);
  });

  it('PUT /plans/employees/:id/month — чужая сеть получает 403', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/plans/employees/${employeeA.id}/month`,
      headers: { ...authAs(managerB.telegramId), 'content-type': 'application/json' },
      payload: { sim: 50 }
    });
    expect(res.statusCode).toBe(403);
  });

  it('PUT /plans/employees/:id/month — своя сеть может задать план', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/plans/employees/${employeeA.id}/month`,
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { sim: 50 }
    });
    expect(res.statusCode).toBe(200);
  });

  // Регрессия: store_plans (снапшот на сегодня/завтра) материализовался
  // только кроном в 6:00 МСК — правка плана точки среди дня была видна
  // сразу только в GET /plans/stores/daily (считает живьём), а BFQ/
  // live-map/дашборд/отчёты/supervisor-analytics, читающие store_plans
  // напрямую, показывали бы старые цифры вплоть до следующего утра.
  it('PUT /plans/stores/:id/month — снапшот store_plans на сегодня обновляется сразу, без крона', async () => {
    const app = await getApp();
    const today = todayMoscow();

    const first = await app.inject({
      method: 'PUT',
      url: `/plans/stores/${storeA}/month`,
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { sim: 300 }
    });
    expect(first.statusCode).toBe(200);

    const row1 = await query(
      `SELECT sim FROM store_plans WHERE store_id = $1 AND plan_date = $2::date`,
      [storeA, today]
    );
    expect(row1.rows.length).toBe(1);
    const sim1 = Number(row1.rows[0].sim);
    expect(sim1).toBeGreaterThan(0);

    // Меняем план ещё раз тем же днём — снапшот должен пересчитаться, а не
    // остаться на значении первой правки.
    const second = await app.inject({
      method: 'PUT',
      url: `/plans/stores/${storeA}/month`,
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { sim: 3000 }
    });
    expect(second.statusCode).toBe(200);

    const row2 = await query(
      `SELECT sim FROM store_plans WHERE store_id = $1 AND plan_date = $2::date`,
      [storeA, today]
    );
    expect(row2.rows.length).toBe(1);
    expect(Number(row2.rows[0].sim)).toBeGreaterThan(sim1);
  });
});
