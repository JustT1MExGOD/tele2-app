import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';

// Регрессия на 15.15.0: getLiveNetworkMap() была самой грубой дырой — живая
// карта показывала имена, продажи и кассу вообще всех сетей сразу.
describe('Изоляция живой карты (GET /network/live)', () => {
  const fx = new TestFixtures();
  let orgA: string, orgB: string;
  let storeA: string, storeB: string;
  let managerA: { id: number; telegramId: number };
  let managerB: { id: number; telegramId: number };
  let admin: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A');
    orgB = await fx.createOrg('Org B');
    storeA = await fx.createStore(orgA);
    storeB = await fx.createStore(orgB);
    managerA = await fx.createEmployee(orgA, { role: 'manager' });
    managerB = await fx.createEmployee(orgB, { role: 'manager' });
    admin = await fx.createEmployee(orgA, { role: 'admin' });
  });

  afterAll(() => fx.cleanup());

  it('manager видит на карте только точки своей сети', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/network/live', headers: authAs(managerA.telegramId) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const rows = body.stores;
    expect(rows.find((r: any) => r.store_id === storeA)).toBeDefined();
    expect(rows.find((r: any) => r.store_id === storeB)).toBeUndefined();
  });

  it('manager чужой сети не видит нашу точку вообще', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/network/live', headers: authAs(managerB.telegramId) });
    const body = res.json();
    const rows = body.stores;
    expect(rows.find((r: any) => r.store_id === storeA)).toBeUndefined();
  });

  it('admin с override org_id видит карту выбранной сети', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/network/live?org_id=${encodeURIComponent(orgB)}`,
      headers: authAs(admin.telegramId)
    });
    const body = res.json();
    const rows = body.stores;
    expect(rows.find((r: any) => r.store_id === storeB)).toBeDefined();
    expect(rows.find((r: any) => r.store_id === storeA)).toBeUndefined();
  });
});
