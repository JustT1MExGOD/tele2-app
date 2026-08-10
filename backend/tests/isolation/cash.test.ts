import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';

// Регрессия: PUT /cash раньше вообще не проверял assertStoreInOrg — любой
// активный пользователь мог записать кассу на точку любой чужой сети (в
// отличие от /schedules и /sales, где эта проверка уже была). Найдено и
// исправлено в этом же заходе (эпик 17.0) — routes-cash.ts.
describe('Изоляция кассы (PUT /cash)', () => {
  const fx = new TestFixtures();
  let orgA: string, orgB: string;
  let storeA: string, storeB: string;
  let employeeA: { id: number; telegramId: number };
  let employeeB: { id: number; telegramId: number };
  let admin: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A');
    orgB = await fx.createOrg('Org B');
    storeA = await fx.createStore(orgA);
    storeB = await fx.createStore(orgB);
    employeeA = await fx.createEmployee(orgA, { role: 'employee' });
    employeeB = await fx.createEmployee(orgB, { role: 'employee' });
    admin = await fx.createEmployee(orgA, { role: 'admin' });
  });

  afterAll(() => fx.cleanup());

  it('сотрудник не может записать кассу на точку чужой сети', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/cash',
      headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
      payload: { store_id: storeB, cash_date: '2026-06-15', cash_fact: 1000, cash_1c: 900 }
    });
    expect(res.statusCode).toBe(403);
  });

  it('сотрудник может записать кассу на точку своей сети', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/cash',
      headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
      payload: { store_id: storeA, cash_date: '2026-06-15', cash_fact: 1000, cash_1c: 900 }
    });
    expect(res.statusCode).toBe(200);
  });

  it('не-admin override org_id игнорируется — по-прежнему 403 на чужой точке', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/cash',
      headers: { ...authAs(employeeB.telegramId), 'content-type': 'application/json' },
      payload: { store_id: storeA, cash_date: '2026-06-15', cash_fact: 1000, cash_1c: 900, org_id: orgA }
    });
    expect(res.statusCode).toBe(403);
  });

  it('admin с override org_id может записать кассу на точку выбранной сети', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/cash',
      headers: { ...authAs(admin.telegramId), 'content-type': 'application/json' },
      payload: { store_id: storeB, cash_date: '2026-06-15', cash_fact: 500, cash_1c: 400, org_id: orgB }
    });
    expect(res.statusCode).toBe(200);
  });
});
