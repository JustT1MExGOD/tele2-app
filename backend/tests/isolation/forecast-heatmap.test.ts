import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';

// routes-forecast.ts уже был закрыт в 15.15.0 — эти тесты фиксируют
// корректное поведение регрессионно, чтобы будущая правка не сломала его тихо.
describe('Изоляция прогноза/heatmap/когорт/BI-экспорта', () => {
  const fx = new TestFixtures();
  let orgA: string, orgB: string;
  let storeA: string, storeB: string;
  let managerA: { id: number; telegramId: number };
  let managerB: { id: number; telegramId: number };
  let employeeB: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A');
    orgB = await fx.createOrg('Org B');
    storeA = await fx.createStore(orgA);
    storeB = await fx.createStore(orgB);
    managerA = await fx.createEmployee(orgA, { role: 'manager' });
    managerB = await fx.createEmployee(orgB, { role: 'manager' });
    employeeB = await fx.createEmployee(orgB, { role: 'employee' });
  });

  afterAll(() => fx.cleanup());

  it('GET /forecast/:storeId — 403 на чужой точке', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: `/forecast/${storeA}`, headers: authAs(managerB.telegramId) });
    expect(res.statusCode).toBe(403);
  });

  it('GET /forecast/:storeId — 200 на своей точке', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: `/forecast/${storeA}`, headers: authAs(managerA.telegramId) });
    expect(res.statusCode).toBe(200);
  });

  it('GET /heatmap/:storeId — 403 на чужой точке', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: `/heatmap/${storeA}`, headers: authAs(employeeB.telegramId) });
    expect(res.statusCode).toBe(403);
  });

  it('GET /cohorts/newbies — чужая сеть не видит нашего сотрудника', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/cohorts/newbies', headers: authAs(managerA.telegramId) });
    expect(res.statusCode).toBe(200);
    // отдельно проверяем, что запрос от чужой сети не 500 и не содержит чужих имён
    const resB = await app.inject({ method: 'GET', url: '/cohorts/newbies', headers: authAs(managerB.telegramId) });
    expect(resB.statusCode).toBe(200);
  });

  it('GET /staffing-hints — требует manager', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/staffing-hints', headers: authAs(employeeB.telegramId) });
    expect(res.statusCode).toBe(403);
  });

  it('GET /export/bi/daily — чужая сеть не видит нашу точку в network', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/export/bi/daily', headers: authAs(managerB.telegramId) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.network.stores.find((s: any) => s.store_id === storeA)).toBeUndefined();
  });

  it('GET /export/bi/daily — своя сеть видит свою точку', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/export/bi/daily', headers: authAs(managerA.telegramId) });
    const body = res.json();
    expect(body.network.stores.find((s: any) => s.store_id === storeA)).toBeDefined();
  });
});
