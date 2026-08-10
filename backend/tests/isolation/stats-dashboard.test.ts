import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/db/index.js';
import { todayMoscow } from '../../src/utils/date.js';

describe('Изоляция статистики (/stats/daily, /dashboard)', () => {
  const fx = new TestFixtures();
  // /dashboard считает окно "последние 7 дней от сегодня" на сервере — фикстуре
  // нужна СЕГОДНЯШНЯЯ дата, фиксированная дата в прошлом туда бы не попала.
  const DATE = todayMoscow();
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
    employeeA = await fx.createEmployee(orgA, { role: 'employee', fullName: 'Stats Employee A' });

    await query(
      `INSERT INTO sales (employee_id, store_id, sale_date, sim, mnp, pa) VALUES ($1, $2, $3, 5, 2, 1)`,
      [employeeA.id, storeA, DATE]
    );
  });

  afterAll(() => fx.cleanup());

  it('GET /stats/daily — manager чужой сети не видит точку другой сети', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: `/stats/daily?date=${DATE}`, headers: authAs(managerB.telegramId) });
    const rows = res.json();
    expect(rows.find((r: any) => r.store_id === storeA)).toBeUndefined();
  });

  it('GET /stats/daily — manager своей сети видит свою точку с фактом', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: `/stats/daily?date=${DATE}`, headers: authAs(managerA.telegramId) });
    const rows = res.json();
    const row = rows.find((r: any) => r.store_id === storeA);
    expect(row).toBeDefined();
    expect(Number(row.sim)).toBe(5);
  });

  it('GET /dashboard (топ за 7 дней) — manager чужой сети не видит сотрудника другой сети', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/dashboard', headers: authAs(managerB.telegramId) });
    const body = res.json();
    expect(body.top.find((r: any) => Number(r.employee_id) === employeeA.id)).toBeUndefined();
  });

  it('GET /dashboard — manager своей сети видит сотрудника в топе', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/dashboard', headers: authAs(managerA.telegramId) });
    const body = res.json();
    expect(body.top.find((r: any) => Number(r.employee_id) === employeeA.id)).toBeDefined();
  });
});
