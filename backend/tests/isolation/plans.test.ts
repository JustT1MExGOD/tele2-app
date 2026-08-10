import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';

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
});
