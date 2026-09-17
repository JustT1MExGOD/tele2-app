/**
 * Admin Control Center, Phase 4+ — Plan Correction Center: single-metric
 * correct for employee/store month plans (no void, no step-up — see
 * core/admin/plan-correction.ts's header comment), stale-version
 * conflicts, unknown-metric rejection, audit trail, and
 * store-plan re-materialization for the current month.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import { todayMoscow } from '../../src/utils/date.js';

describe('Admin Control Center — Plan Correction Center', () => {
  const fx = new TestFixtures();
  let orgA: string;
  let storeA: string;
  let adminA: { id: number; telegramId: number; telegramGrantToken?: string };
  let managerA: { id: number; telegramId: number; telegramGrantToken?: string };
  let employeeA: { id: number; telegramId: number };
  const currentMonth = todayMoscow().slice(0, 8) + '01';

  beforeAll(async () => {
    orgA = await fx.createOrg('Plan Correction Org A');
    storeA = await fx.createStore(orgA, 'Store A1');
    adminA = await fx.createEmployee(orgA, { role: 'admin' });
    managerA = await fx.createEmployee(orgA, { role: 'manager' });
    employeeA = await fx.createEmployee(orgA, { role: 'employee' });
  });

  afterAll(async () => {
    await query(`DELETE FROM audit_log WHERE org_id = $1`, [orgA]);
    await query(`DELETE FROM store_plans WHERE store_id = $1`, [storeA]);
    await fx.cleanup();
  });

  async function seedEmployeePlan(month: string, sim = 10, mnp = 5) {
    const res = await query(
      `INSERT INTO employee_month_plans (employee_id, month, sim, mnp) VALUES ($1, $2::date, $3, $4) RETURNING *`,
      [employeeA.id, month, sim, mnp]
    );
    return res.rows[0];
  }

  async function seedStorePlan(month: string, sim = 100, mnp = 50) {
    const res = await query(
      `INSERT INTO store_month_plans (store_id, month, sim, mnp) VALUES ($1, $2::date, $3, $4) RETURNING *`,
      [storeA, month, sim, mnp]
    );
    return res.rows[0];
  }

  it('non-admin (manager/employee) is blocked from every /admin/plans/* route', async () => {
    const app = await getApp();
    const empPlan = await seedEmployeePlan('2024-05-01');
    for (const url of [`/admin/plans/employees/${empPlan.id}`]) {
      const resManager = await app.inject({ method: 'GET', url, headers: authAs(managerA.telegramId) });
      expect(resManager.statusCode).toBe(403);
      const resEmployee = await app.inject({ method: 'GET', url, headers: authAs(employeeA.telegramId) });
      expect(resEmployee.statusCode).toBe(403);
    }
    const correctManager = await app.inject({
      method: 'POST', url: `/admin/plans/employees/${empPlan.id}/correct-metric`,
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { metric: 'sim', value: 20, version: empPlan.version, reason: 'test' }
    });
    expect(correctManager.statusCode).toBe(403);
  });

  it('correct-metric on an employee plan updates a single metric, bumps version, and writes EMPLOYEE_PLAN_CORRECTED audit', async () => {
    const app = await getApp();
    const plan = await seedEmployeePlan('2024-05-02', 10, 5);
    const res = await app.inject({
      method: 'POST', url: `/admin/plans/employees/${plan.id}/correct-metric`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { metric: 'sim', value: 25, version: plan.version, reason: 'план был занижен' }
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json().row;
    expect(Number(updated.sim)).toBe(25);
    expect(Number(updated.mnp)).toBe(5);
    expect(Number(updated.version)).toBe(Number(plan.version) + 1);
    expect(res.json().metrics.sim.value).toBe(25);

    const audit = await query(
      `SELECT * FROM audit_log WHERE action = 'EMPLOYEE_PLAN_CORRECTED' AND target_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [String(plan.id)]
    );
    expect(audit.rows[0].before.sim).toBe(10);
    expect(audit.rows[0].after.sim).toBe(25);
    expect(audit.rows[0].after.reason).toBe('план был занижен');
  });

  it('correct-metric requires a reason', async () => {
    const app = await getApp();
    const plan = await seedEmployeePlan('2024-05-03');
    const res = await app.inject({
      method: 'POST', url: `/admin/plans/employees/${plan.id}/correct-metric`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { metric: 'sim', value: 20, version: plan.version }
    });
    expect(res.statusCode).toBe(400);
  });

  it('correct-metric rejects an unknown metric name', async () => {
    const app = await getApp();
    const plan = await seedEmployeePlan('2024-05-04');
    const res = await app.inject({
      method: 'POST', url: `/admin/plans/employees/${plan.id}/correct-metric`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { metric: 'employee_id', value: 20, version: plan.version, reason: 'x' }
    });
    expect(res.statusCode).toBe(400);
  });

  it('a stale version on correct-metric is rejected with a conflict', async () => {
    const app = await getApp();
    const plan = await seedEmployeePlan('2024-05-05');
    const res = await app.inject({
      method: 'POST', url: `/admin/plans/employees/${plan.id}/correct-metric`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { metric: 'sim', value: 20, version: Number(plan.version) + 99, reason: 'x' }
    });
    expect(res.statusCode).toBe(409);
  });

  it('correct-metric on a store plan for the current month re-materializes store_plans', async () => {
    const app = await getApp();
    const plan = await seedStorePlan(currentMonth, 100, 50);
    const res = await app.inject({
      method: 'POST', url: `/admin/plans/stores/${plan.id}/correct-metric`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { metric: 'sim', value: 250, version: plan.version, reason: 'план точки скорректирован' }
    });
    expect(res.statusCode).toBe(200);
    expect(Number(res.json().row.sim)).toBe(250);

    const today = todayMoscow();
    const materialized = await query(
      `SELECT * FROM store_plans WHERE store_id = $1 AND plan_date = $2::date`,
      [storeA, today]
    );
    expect(materialized.rows.length).toBe(1);

    const audit = await query(
      `SELECT * FROM audit_log WHERE action = 'STORE_PLAN_CORRECTED' AND target_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [String(plan.id)]
    );
    expect(audit.rows[0].before.sim).toBe(100);
    expect(audit.rows[0].after.sim).toBe(250);
  });

  it('correct-metric on a store plan for a past month does not touch store_plans', async () => {
    const app = await getApp();
    const plan = await seedStorePlan('2020-01-01', 100, 50);
    const res = await app.inject({
      method: 'POST', url: `/admin/plans/stores/${plan.id}/correct-metric`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { metric: 'sim', value: 250, version: plan.version, reason: 'x' }
    });
    expect(res.statusCode).toBe(200);

    const materialized = await query(
      `SELECT * FROM store_plans WHERE store_id = $1 AND plan_date >= '2020-01-01' AND plan_date < '2020-02-01'`,
      [storeA]
    );
    expect(materialized.rows.length).toBe(0);
  });
});
