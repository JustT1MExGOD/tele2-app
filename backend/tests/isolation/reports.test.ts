import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';

// Регрессия: GET /reports/day/:storeId не проверял, что точка принадлежит
// сети запрашивающего — превью отчёта чужой точки можно было запросить,
// зная/угадав её id (слаги вроде "kalinina2" несложно угадать).
describe('Изоляция превью отчёта (GET /reports/day/:storeId)', () => {
  const fx = new TestFixtures();
  let orgA: string, orgB: string;
  let storeA: string, storeB: string;
  let employeeA: { id: number; telegramId: number };
  let employeeB: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A');
    orgB = await fx.createOrg('Org B');
    storeA = await fx.createStore(orgA);
    storeB = await fx.createStore(orgB);
    employeeA = await fx.createEmployee(orgA, { role: 'employee' });
    employeeB = await fx.createEmployee(orgB, { role: 'employee' });
  });

  afterAll(() => fx.cleanup());

  it('чужая сеть получает 403 на превью отчёта чужой точки', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/reports/day/${storeA}?date=2026-06-19`,
      headers: authAs(employeeB.telegramId)
    });
    expect(res.statusCode).toBe(403);
  });

  it('своя сеть может запросить превью своей точки', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/reports/day/${storeA}?date=2026-06-19`,
      headers: authAs(employeeA.telegramId)
    });
    expect(res.statusCode).not.toBe(403);
  });
});
