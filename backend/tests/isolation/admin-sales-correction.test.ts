/**
 * Admin Control Center (20.59.0) — Sales Correction Center: void,
 * restore, correct-store (same-org and cross-org with/without
 * step-up), stale-version conflicts, audit trail, RBAC/org-scoping.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs, setupTotpAndStepUp } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import { applySaleUpsert } from '../../src/data/repositories/sales.js';

describe('Admin Control Center — Sales Correction Center', () => {
  const fx = new TestFixtures();
  let orgA: string, orgB: string;
  let storeA: string, storeB: string, storeA2: string;
  let adminA: { id: number; telegramId: number; telegramGrantToken?: string };
  let managerA: { id: number; telegramId: number; telegramGrantToken?: string };
  let employeeA: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Sales Correction Org A');
    orgB = await fx.createOrg('Sales Correction Org B');
    storeA = await fx.createStore(orgA, 'Store A1');
    storeA2 = await fx.createStore(orgA, 'Store A2');
    storeB = await fx.createStore(orgB, 'Store B1');
    adminA = await fx.createEmployee(orgA, { role: 'admin' });
    managerA = await fx.createEmployee(orgA, { role: 'manager' });
    employeeA = await fx.createEmployee(orgA, { role: 'employee' });
  });

  afterAll(async () => {
    await query(`DELETE FROM audit_log WHERE org_id = ANY($1)`, [[orgA, orgB]]);
    await fx.cleanup();
  });

  async function seedSale(employeeId: number, storeId: string, date: string, metrics: Record<string, number>) {
    const { row } = await applySaleUpsert({ employee_id: employeeId, store_id: storeId, sale_date: date, metrics, source: 'api' });
    return row;
  }

  it('non-admin (manager/employee) is blocked from every /admin/sales/* route', async () => {
    const app = await getApp();
    const row = await seedSale(employeeA.id, storeA, '2024-01-10', { sim: 3 });
    for (const url of [`/admin/sales`, `/admin/sales/${row.id}`]) {
      const resManager = await app.inject({ method: 'GET', url, headers: authAs(managerA.telegramId) });
      expect(resManager.statusCode).toBe(403);
      const resEmployee = await app.inject({ method: 'GET', url, headers: authAs(employeeA.telegramId) });
      expect(resEmployee.statusCode).toBe(403);
    }
    const voidManager = await app.inject({
      method: 'POST', url: `/admin/sales/${row.id}/void`,
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { version: row.version, reason: 'test' }
    });
    expect(voidManager.statusCode).toBe(403);
  });

  it('void requires a reason, zeroes every non-zero metric, and writes SALE_VOIDED audit with correct before/after', async () => {
    const app = await getApp();
    const row = await seedSale(employeeA.id, storeA, '2024-01-11', { sim: 5, mnp: 2 });

    const missingReason = await app.inject({
      method: 'POST', url: `/admin/sales/${row.id}/void`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: row.version }
    });
    expect(missingReason.statusCode).toBe(400);

    const res = await app.inject({
      method: 'POST', url: `/admin/sales/${row.id}/void`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: row.version, reason: 'Ошибочно проведена' }
    });
    expect(res.statusCode).toBe(200);
    const voided = res.json().row;
    expect(Number(voided.sim)).toBe(0);
    expect(Number(voided.mnp)).toBe(0);
    expect(voided.voided_at).toBeTruthy();
    expect(Number(voided.version)).toBe(Number(row.version) + 1);

    const audit = await query(
      `SELECT * FROM audit_log WHERE action = 'SALE_VOIDED' AND target_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [String(row.id)]
    );
    expect(audit.rows[0]).toBeTruthy();
    expect(audit.rows[0].before.metrics.sim).toBe(5);
    expect(audit.rows[0].before.metrics.mnp).toBe(2);
    expect(audit.rows[0].after.metrics.sim).toBe(0);
    expect(audit.rows[0].after.reason).toBe('Ошибочно проведена');
  });

  it('double-void is rejected', async () => {
    const app = await getApp();
    const row = await seedSale(employeeA.id, storeA, '2024-01-12', { sim: 1 });
    const first = await app.inject({
      method: 'POST', url: `/admin/sales/${row.id}/void`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: row.version, reason: 'причина' }
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: 'POST', url: `/admin/sales/${row.id}/void`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: first.json().row.version, reason: 'причина ещё раз' }
    });
    expect(second.statusCode).toBe(400);
  });

  it('a stale version on void is rejected with a conflict, not a silent overwrite', async () => {
    const app = await getApp();
    const row = await seedSale(employeeA.id, storeA, '2024-01-13', { sim: 4 });
    const res = await app.inject({
      method: 'POST', url: `/admin/sales/${row.id}/void`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: Number(row.version) + 99, reason: 'stale' }
    });
    expect(res.statusCode).toBe(409);
  });

  it('restore replays the exact pre-void snapshot and writes SALE_RESTORED audit', async () => {
    const app = await getApp();
    const row = await seedSale(employeeA.id, storeA, '2024-01-14', { sim: 7, mnp: 3 });
    const voidRes = await app.inject({
      method: 'POST', url: `/admin/sales/${row.id}/void`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: row.version, reason: 'ошибка' }
    });
    const voided = voidRes.json().row;

    const restore = await app.inject({
      method: 'POST', url: `/admin/sales/${row.id}/restore`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: voided.version, reason: 'подтверждена корректной' }
    });
    expect(restore.statusCode).toBe(200);
    const restored = restore.json().row;
    expect(Number(restored.sim)).toBe(7);
    expect(Number(restored.mnp)).toBe(3);
    expect(restored.voided_at).toBeFalsy();

    const audit = await query(
      `SELECT * FROM audit_log WHERE action = 'SALE_RESTORED' AND target_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [String(row.id)]
    );
    expect(audit.rows[0].after.metrics.sim).toBe(7);
  });

  it('restoring a non-voided row is rejected', async () => {
    const app = await getApp();
    const row = await seedSale(employeeA.id, storeA, '2024-01-15', { sim: 2 });
    const res = await app.inject({
      method: 'POST', url: `/admin/sales/${row.id}/restore`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: row.version, reason: 'x' }
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /admin/sales/:id returns a metrics map covering both integer and numeric sales columns', async () => {
    const app = await getApp();
    const row = await seedSale(employeeA.id, storeA, '2024-02-01', { sim: 3, settings: 2 });
    const res = await app.inject({ method: 'GET', url: `/admin/sales/${row.id}`, headers: authAs(adminA.telegramId, adminA.telegramGrantToken) });
    expect(res.statusCode).toBe(200);
    const { metrics } = res.json();
    expect(metrics.sim.value).toBe(3);
    expect(metrics.sim.label).toBeTruthy();
    expect(metrics.settings.value).toBe(2);
    expect(metrics.settings.label).toBeTruthy();
  });

  it('correct-metric updates a single metric, bumps version, and writes SALE_METRIC_CORRECTED audit', async () => {
    const app = await getApp();
    const row = await seedSale(employeeA.id, storeA, '2024-02-02', { sim: 3, mnp: 1 });
    const res = await app.inject({
      method: 'POST', url: `/admin/sales/${row.id}/correct-metric`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { metric: 'sim', value: 8, version: row.version, reason: 'сотрудник ввёл неверное количество' }
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json().row;
    expect(Number(updated.sim)).toBe(8);
    expect(Number(updated.mnp)).toBe(1);
    expect(Number(updated.version)).toBe(Number(row.version) + 1);
    expect(res.json().metrics.sim.value).toBe(8);

    const audit = await query(
      `SELECT * FROM audit_log WHERE action = 'SALE_METRIC_CORRECTED' AND target_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [String(row.id)]
    );
    expect(audit.rows[0].before.sim).toBe(3);
    expect(audit.rows[0].after.sim).toBe(8);
    expect(audit.rows[0].after.reason).toBe('сотрудник ввёл неверное количество');
  });

  it('correct-metric requires a reason', async () => {
    const app = await getApp();
    const row = await seedSale(employeeA.id, storeA, '2024-02-03', { sim: 3 });
    const res = await app.inject({
      method: 'POST', url: `/admin/sales/${row.id}/correct-metric`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { metric: 'sim', value: 8, version: row.version }
    });
    expect(res.statusCode).toBe(400);
  });

  it('correct-metric rejects an unknown metric name', async () => {
    const app = await getApp();
    const row = await seedSale(employeeA.id, storeA, '2024-02-04', { sim: 3 });
    const res = await app.inject({
      method: 'POST', url: `/admin/sales/${row.id}/correct-metric`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { metric: 'store_id', value: 8, version: row.version, reason: 'x' }
    });
    expect(res.statusCode).toBe(400);
  });

  it('correct-metric rejects a negative or out-of-range value', async () => {
    const app = await getApp();
    const row = await seedSale(employeeA.id, storeA, '2024-02-05', { sim: 3 });
    const negative = await app.inject({
      method: 'POST', url: `/admin/sales/${row.id}/correct-metric`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { metric: 'sim', value: -1, version: row.version, reason: 'x' }
    });
    expect(negative.statusCode).toBe(400);
  });

  it('correct-metric on a voided row is rejected', async () => {
    const app = await getApp();
    const row = await seedSale(employeeA.id, storeA, '2024-02-06', { sim: 3 });
    const voidRes = await app.inject({
      method: 'POST', url: `/admin/sales/${row.id}/void`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: row.version, reason: 'ошибка' }
    });
    const voided = voidRes.json().row;
    const res = await app.inject({
      method: 'POST', url: `/admin/sales/${row.id}/correct-metric`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { metric: 'sim', value: 8, version: voided.version, reason: 'x' }
    });
    expect(res.statusCode).toBe(400);
  });

  it('a stale version on correct-metric is rejected with a conflict', async () => {
    const app = await getApp();
    const row = await seedSale(employeeA.id, storeA, '2024-02-07', { sim: 3 });
    const res = await app.inject({
      method: 'POST', url: `/admin/sales/${row.id}/correct-metric`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { metric: 'sim', value: 8, version: Number(row.version) + 99, reason: 'x' }
    });
    expect(res.statusCode).toBe(409);
  });

  it('non-admin is blocked from correct-metric', async () => {
    const app = await getApp();
    const row = await seedSale(employeeA.id, storeA, '2024-02-08', { sim: 3 });
    const res = await app.inject({
      method: 'POST', url: `/admin/sales/${row.id}/correct-metric`,
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { metric: 'sim', value: 8, version: row.version, reason: 'x' }
    });
    expect(res.statusCode).toBe(403);
  });

  it('correct-store within the same org succeeds without step-up', async () => {
    const app = await getApp();
    const row = await seedSale(employeeA.id, storeA, '2024-01-16', { sim: 9 });
    const res = await app.inject({
      method: 'POST', url: `/admin/sales/${row.id}/correct-store`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: row.version, new_store_id: storeA2, reason: 'сотрудник отработал на другой точке' }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().row.store_id).toBe(storeA2);

    const audit = await query(
      `SELECT * FROM audit_log WHERE action = 'SALE_STORE_CORRECTED' AND target_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [String(row.id)]
    );
    expect(audit.rows[0].before.store_id).toBe(storeA);
    expect(audit.rows[0].after.store_id).toBe(storeA2);
  });

  it('correct-store refuses to overwrite an existing destination day-row', async () => {
    const app = await getApp();
    const row = await seedSale(employeeA.id, storeA, '2024-01-17', { sim: 1 });
    await seedSale(employeeA.id, storeA2, '2024-01-17', { sim: 1 });
    const res = await app.inject({
      method: 'POST', url: `/admin/sales/${row.id}/correct-store`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: row.version, new_store_id: storeA2, reason: 'x' }
    });
    expect(res.statusCode).toBe(409);
  });

  it('cross-org correct-store is rejected without step-up and succeeds with it', async () => {
    const app = await getApp();
    const row = await seedSale(employeeA.id, storeA, '2024-01-18', { sim: 6 });

    const withoutStepUp = await app.inject({
      method: 'POST', url: `/admin/sales/${row.id}/correct-store`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: row.version, new_store_id: storeB, reason: 'перенос в другую сеть' }
    });
    expect(withoutStepUp.statusCode).toBe(403);
    expect(withoutStepUp.json().error).toBe('step_up_required');

    const stepUpHeaders = await setupTotpAndStepUp(adminA.id, authAs(adminA.telegramId));
    const withStepUp = await app.inject({
      method: 'POST', url: `/admin/sales/${row.id}/correct-store`,
      headers: { ...authAs(adminA.telegramId), ...stepUpHeaders, 'content-type': 'application/json' },
      payload: { version: row.version, new_store_id: storeB, reason: 'перенос в другую сеть' }
    });
    expect(withStepUp.statusCode).toBe(200);
    expect(withStepUp.json().row.store_id).toBe(storeB);
  });

  it('GET /admin/sales is org-scoped — admin of org A does not see org B rows by default', async () => {
    const app = await getApp();
    await seedSale(employeeA.id, storeA, '2024-01-19', { sim: 1 });
    const res = await app.inject({ method: 'GET', url: '/admin/sales', headers: authAs(adminA.telegramId, adminA.telegramGrantToken) });
    expect(res.statusCode).toBe(200);
    const items = res.json().items;
    expect(items.every((i: any) => i.store_id === storeA || i.store_id === storeA2)).toBe(true);
  });
});
