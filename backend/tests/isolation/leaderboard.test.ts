/**
 * «Топы сотрудников» (план, 20.75.0) — GET /leaderboard: топ по ОДНОЙ
 * метрике за период (не сводный score), видно всем ролям, org-scoped
 * через resolveViewOrgId (своя сеть по умолчанию, admin может явно
 * переключиться — org-switcher в шапке с 20.73.0). Два источника данных
 * для метрики — реальная колонка sales (sim) и EAV-таблица
 * sale_metric_values (для метрик без собственной колонки) — оба
 * покрыты; период реально фильтрует; неизвестная метрика — 400.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import { invalidateMetricsCache } from '../../src/core/shared/metrics-catalog.js';

describe('GET /leaderboard', () => {
  const fx = new TestFixtures();
  const customMetricId = `t17_cm_${Date.now().toString(36)}`;

  afterAll(async () => {
    await query(`DELETE FROM sale_metric_values WHERE metric_id = $1`, [customMetricId]);
    await query(`DELETE FROM plan_metrics WHERE id = $1`, [customMetricId]);
    await fx.cleanup();
  });

  it('топ по sim (реальная колонка sales) — сортировка по убыванию, нулевые не попадают', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Leaderboard Sim Org');
    const store = await fx.createStore(org, 'Точка');
    const top = await fx.createEmployee(org, { role: 'employee', fullName: 'Лидер' });
    const second = await fx.createEmployee(org, { role: 'employee', fullName: 'Второй' });
    const zero = await fx.createEmployee(org, { role: 'employee', fullName: 'Без продаж' });

    await query(`INSERT INTO sales (employee_id, store_id, sale_date, sim) VALUES ($1,$2,'2026-06-10',10)`, [top.id, store]);
    await query(`INSERT INTO sales (employee_id, store_id, sale_date, sim) VALUES ($1,$2,'2026-06-11',3)`, [second.id, store]);
    await query(`INSERT INTO sales (employee_id, store_id, sale_date, sim) VALUES ($1,$2,'2026-06-12',0)`, [zero.id, store]);

    const res = await app.inject({
      method: 'GET',
      url: '/leaderboard?metric=sim&from=2026-06-01&to=2026-06-30',
      headers: authAs(top.telegramId)
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.metric.id).toBe('sim');
    expect(body.items.map((i: any) => i.employee_id)).toEqual([top.id, second.id]);
    expect(body.items[0]).toMatchObject({ rank: 1, full_name: 'Лидер', value: 10 });
    expect(body.items.some((i: any) => i.employee_id === zero.id)).toBe(false);
  });

  it('период реально фильтрует — продажа вне диапазона не попадает в сумму', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Leaderboard Period Org');
    const store = await fx.createStore(org, 'Точка');
    const emp = await fx.createEmployee(org, { role: 'employee', fullName: 'Сотрудник' });

    await query(`INSERT INTO sales (employee_id, store_id, sale_date, sim) VALUES ($1,$2,'2026-05-15',7)`, [emp.id, store]);
    await query(`INSERT INTO sales (employee_id, store_id, sale_date, sim) VALUES ($1,$2,'2026-06-15',4)`, [emp.id, store]);

    const res = await app.inject({
      method: 'GET',
      url: '/leaderboard?metric=sim&from=2026-06-01&to=2026-06-30',
      headers: authAs(emp.telegramId)
    });
    expect(res.json().items[0].value).toBe(4);
  });

  it('EAV-метрика (sale_metric_values, не колонка sales) — тот же топ работает', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Leaderboard EAV Org');
    const store = await fx.createStore(org, 'Точка');
    const emp = await fx.createEmployee(org, { role: 'employee', fullName: 'EAV Сотрудник' });

    await query(
      `INSERT INTO plan_metrics (id, label, short_label, unit, is_active, sort_order) VALUES ($1,'Custom','Cust','count',true,999)
       ON CONFLICT (id) DO NOTHING`,
      [customMetricId]
    );
    // getMetricDefs()/getSalesSumColumns() кэшируют в памяти (TTL 30с) —
    // другой тест в этом же прогоне уже мог прогреть кэш ДО этой вставки.
    invalidateMetricsCache();
    await query(
      `INSERT INTO sale_metric_values (id, employee_id, store_id, sale_date, metric_id, value) VALUES (nextval('sale_metric_values_id_seq'),$1,$2,'2026-06-10',$3,8)`,
      [emp.id, store, customMetricId]
    );

    const res = await app.inject({
      method: 'GET',
      url: `/leaderboard?metric=${customMetricId}&from=2026-06-01&to=2026-06-30`,
      headers: authAs(emp.telegramId)
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([{ rank: 1, employee_id: emp.id, full_name: 'EAV Сотрудник', value: 8 }]);
  });

  it('неизвестная метрика — 400', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Leaderboard Unknown Metric Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const res = await app.inject({ method: 'GET', url: '/leaderboard?metric=does_not_exist_xyz', headers: authAs(emp.telegramId) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('unknown_metric');
  });

  it('org-изоляция: сотрудник видит только свою сеть; admin видит чужую через ?org_id (org-switcher)', async () => {
    const app = await getApp();
    const orgA = await fx.createOrg('Leaderboard Org A');
    const orgB = await fx.createOrg('Leaderboard Org B');
    const storeA = await fx.createStore(orgA, 'Точка A');
    const storeB = await fx.createStore(orgB, 'Точка B');
    const empA = await fx.createEmployee(orgA, { role: 'employee', fullName: 'Сотрудник A' });
    const empB = await fx.createEmployee(orgB, { role: 'employee', fullName: 'Сотрудник B' });
    const adminA = await fx.createEmployee(orgA, { role: 'admin' });

    await query(`INSERT INTO sales (employee_id, store_id, sale_date, sim) VALUES ($1,$2,'2026-06-10',5)`, [empA.id, storeA]);
    await query(`INSERT INTO sales (employee_id, store_id, sale_date, sim) VALUES ($1,$2,'2026-06-10',9)`, [empB.id, storeB]);

    const ownView = await app.inject({
      method: 'GET',
      url: '/leaderboard?metric=sim&from=2026-06-01&to=2026-06-30',
      headers: authAs(empA.telegramId)
    });
    expect(ownView.json().items.map((i: any) => i.employee_id)).toEqual([empA.id]);

    // не-admin игнорирует org_id override — видит только свою сеть.
    const ignoredOverride = await app.inject({
      method: 'GET',
      url: `/leaderboard?metric=sim&from=2026-06-01&to=2026-06-30&org_id=${orgB}`,
      headers: authAs(empA.telegramId)
    });
    expect(ignoredOverride.json().items.map((i: any) => i.employee_id)).toEqual([empA.id]);

    // admin может явно переключиться на сеть B через org_id (org-switcher).
    const adminSwitched = await app.inject({
      method: 'GET',
      url: `/leaderboard?metric=sim&from=2026-06-01&to=2026-06-30&org_id=${orgB}`,
      headers: authAs(adminA.telegramId, adminA.telegramGrantToken)
    });
    expect(adminSwitched.json().items.map((i: any) => i.employee_id)).toEqual([empB.id]);
  });

  it('"from" позже "to" — 400', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Leaderboard Invalid Range Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const res = await app.inject({
      method: 'GET',
      url: '/leaderboard?metric=sim&from=2026-06-30&to=2026-06-01',
      headers: authAs(emp.telegramId)
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_range');
  });
});
