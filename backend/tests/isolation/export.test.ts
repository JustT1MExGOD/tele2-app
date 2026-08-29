import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

// Регрессия: /sales/history, /sales/audit, /export/sales.csv, /export/bfq.csv,
// /export/schedules.csv были доступны любому manager без фильтра по сети —
// можно было выгрузить продажи/аудит/график/BFQ вообще ВСЕХ сетей разом.
describe('Изоляция истории/аудита/CSV-экспортов (/sales/history, /sales/audit, /export/*)', () => {
  const fx = new TestFixtures();
  const DATE = '2026-06-19';
  let orgA: string, orgB: string;
  let storeA: string;
  let managerA: { id: number; telegramId: number };
  let managerB: { id: number; telegramId: number };
  let employeeA: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A');
    orgB = await fx.createOrg('Org B');
    storeA = await fx.createStore(orgA);
    await fx.createStore(orgB);
    managerA = await fx.createEmployee(orgA, { role: 'manager' });
    managerB = await fx.createEmployee(orgB, { role: 'manager' });
    employeeA = await fx.createEmployee(orgA, { role: 'employee', fullName: 'Export Employee A' });

    await query(
      `INSERT INTO sales (employee_id, store_id, sale_date, sim) VALUES ($1, $2, $3, 3)`,
      [employeeA.id, storeA, DATE]
    );
    await query(
      `INSERT INTO sales_audit (employee_id, store_id, sale_date, metric, delta, source)
       VALUES ($1, $2, $3, 'sim', 3, 'api')`,
      [employeeA.id, storeA, DATE]
    );
    await query(
      `INSERT INTO schedules (employee_id, store_id, work_date, shift_text, hours) VALUES ($1, $2, $3, '10-21', 11)`,
      [employeeA.id, storeA, DATE]
    );
  });

  afterAll(() => fx.cleanup());

  it('GET /sales/history — чужая сеть не видит чужие продажи', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/sales/history?from=${DATE}&to=${DATE}`,
      headers: authAs(managerB.telegramId)
    });
    const body = res.json();
    expect(body.items.find((i: any) => Number(i.employee_id) === employeeA.id)).toBeUndefined();
  });

  it('GET /sales/history — своя сеть видит свои продажи', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/sales/history?from=${DATE}&to=${DATE}`,
      headers: authAs(managerA.telegramId)
    });
    const body = res.json();
    expect(body.items.find((i: any) => Number(i.employee_id) === employeeA.id)).toBeDefined();
  });

  it('GET /sales/audit — чужая сеть не видит чужой аудит', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/sales/audit?from=${DATE}&to=${DATE}`,
      headers: authAs(managerB.telegramId)
    });
    const rows = res.json();
    expect(rows.find((r: any) => Number(r.employee_id) === employeeA.id)).toBeUndefined();
  });

  it('GET /export/sales.csv — чужая сеть не видит чужое имя в выгрузке', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/export/sales.csv?from=${DATE}&to=${DATE}`,
      headers: authAs(managerB.telegramId)
    });
    expect(res.body).not.toContain('Export Employee A');
  });

  it('GET /export/sales.csv — своя сеть видит своё имя в выгрузке', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/export/sales.csv?from=${DATE}&to=${DATE}`,
      headers: authAs(managerA.telegramId)
    });
    expect(res.body).toContain('Export Employee A');
  });

  it('GET /export/schedules.csv — чужая сеть не видит чужой график', async () => {
    const app = await getApp();
    const month = DATE.slice(0, 7);
    const res = await app.inject({
      method: 'GET',
      url: `/export/schedules.csv?month=${month}`,
      headers: authAs(managerB.telegramId)
    });
    expect(res.body).not.toContain('Export Employee A');
  });

  it('GET /export/bfq.csv — чужая сеть не видит чужого сотрудника в BFQ-выгрузке', async () => {
    const app = await getApp();
    const month = DATE.slice(0, 7);
    const res = await app.inject({
      method: 'GET',
      url: `/export/bfq.csv?month=${month}`,
      headers: authAs(managerB.telegramId)
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('Export Employee A');
  });

  // 20.50.0 (Web Security & Trust Layer, часть 3) — findForCsvExport() не
  // несёт LIMIT (в отличие от findSalesAudit()); единственная защита от
  // выгрузки всей истории продаж сети одним запросом — явная ошибка на
  // слишком широкий диапазон дат, не тихая обрезка строк.
  it('GET /export/sales.csv — диапазон >400 дней отклоняется явной ошибкой', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/export/sales.csv?from=2020-01-01&to=2026-06-19',
      headers: authAs(managerA.telegramId)
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('range_too_wide');
  });

  it('GET /export/sales.csv — диапазон ровно 400 дней проходит штатно', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/export/sales.csv?from=2025-05-15&to=${DATE}`,
      headers: authAs(managerA.telegramId)
    });
    expect(res.statusCode).toBe(200);
  });
});
