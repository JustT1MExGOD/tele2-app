import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';

describe('GET /org/stores — точки только своей сети', () => {
  const fx = new TestFixtures();
  let orgA: string, orgB: string;
  let storeA1: string, storeA2: string, storeB1: string;
  let manager: { id: number; telegramId: number };
  let admin: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A');
    orgB = await fx.createOrg('Org B');
    storeA1 = await fx.createStore(orgA, 'A1');
    storeA2 = await fx.createStore(orgA, 'A2');
    storeB1 = await fx.createStore(orgB, 'B1');
    manager = await fx.createEmployee(orgB, { role: 'manager' });
    admin = await fx.createEmployee(orgA, { role: 'admin' });
  });

  afterAll(() => fx.cleanup());

  it('manager своей сети видит только её точки', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/org/stores', headers: authAs(manager.telegramId) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.org_id).toBe(orgB);
    const ids = body.stores.map((s: any) => s.id).sort();
    expect(ids).toEqual([storeB1].sort());
  });

  it('admin без override видит свою сеть', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/org/stores', headers: authAs(admin.telegramId) });
    const body = res.json();
    expect(body.org_id).toBe(orgA);
    expect(body.stores.map((s: any) => s.id).sort()).toEqual([storeA1, storeA2].sort());
  });

  it('admin с override видит запрошенную сеть', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/org/stores?org_id=${encodeURIComponent(orgB)}`,
      headers: authAs(admin.telegramId)
    });
    const body = res.json();
    expect(body.org_id).toBe(orgB);
    expect(body.stores.map((s: any) => s.id)).toEqual([storeB1]);
  });

  it('не-admin override игнорируется — по-прежнему только своя сеть', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/org/stores?org_id=${encodeURIComponent(orgA)}`,
      headers: authAs(manager.telegramId)
    });
    const body = res.json();
    expect(body.org_id).toBe(orgB);
    expect(body.stores.map((s: any) => s.id)).toEqual([storeB1]);
  });
});
