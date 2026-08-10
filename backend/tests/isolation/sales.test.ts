import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';

describe('Изоляция продаж (/sales)', () => {
  const fx = new TestFixtures();
  let orgA: string, orgB: string;
  let storeA: string, storeB: string;
  let managerA: { id: number; telegramId: number };
  let managerB: { id: number; telegramId: number };
  let employeeA: { id: number; telegramId: number };
  let employeeB: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A');
    orgB = await fx.createOrg('Org B');
    storeA = await fx.createStore(orgA);
    storeB = await fx.createStore(orgB);
    managerA = await fx.createEmployee(orgA, { role: 'manager' });
    managerB = await fx.createEmployee(orgB, { role: 'manager' });
    employeeA = await fx.createEmployee(orgA, { role: 'employee' });
    employeeB = await fx.createEmployee(orgB, { role: 'employee' });
  });

  afterAll(() => fx.cleanup());

  it('employee не может вносить продажу за другого сотрудника', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
      payload: { employee_id: employeeB.id, store_id: storeA, sim: 1 }
    });
    expect(res.statusCode).toBe(403);
  });

  it('employee может вносить СВОЮ продажу даже на точке чужой сети (подмена легитимна)', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { ...authAs(employeeB.telegramId), 'content-type': 'application/json' },
      payload: { employee_id: employeeB.id, store_id: storeA, sim: 1, sale_date: '2026-06-20' }
    });
    expect(res.statusCode).toBe(200);
  });

  it('manager не может внести продажу ЗА ДРУГОГО сотрудника на точке чужой сети', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { employee_id: employeeA.id, store_id: storeB, sim: 1, sale_date: '2026-06-20' }
    });
    expect(res.statusCode).toBe(403);
  });

  it('manager может внести продажу за сотрудника своей сети на своей точке', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { employee_id: employeeA.id, store_id: storeA, sim: 2, sale_date: '2026-06-21' }
    });
    expect(res.statusCode).toBe(200);
  });

  it('PUT /sales/:id/zero — manager чужой сети не может обнулить метрику на чужой точке', async () => {
    const app = await getApp();
    const create = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { employee_id: employeeA.id, store_id: storeA, sim: 5, sale_date: '2026-06-22' }
    });
    const saleId = create.json().id;

    const res = await app.inject({
      method: 'PUT',
      url: `/sales/${saleId}/zero`,
      headers: { ...authAs(managerB.telegramId), 'content-type': 'application/json' },
      payload: { metric: 'sim' }
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET /sales — manager чужой сети не видит продажи другой сети', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/sales?date=2026-06-21',
      headers: authAs(managerB.telegramId)
    });
    const rows = res.json();
    expect(rows.find((r: any) => Number(r.employee_id) === employeeA.id)).toBeUndefined();
  });

  it('GET /sales — manager своей сети видит продажи своей точки', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/sales?date=2026-06-21',
      headers: authAs(managerA.telegramId)
    });
    const rows = res.json();
    expect(rows.find((r: any) => Number(r.employee_id) === employeeA.id)).toBeDefined();
  });
});
