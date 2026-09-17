/**
 * Admin Control Center, Phase 4+ — Shift Correction Center: void
 * (closed/auto_closed only, never open), restore, correct (store/date,
 * same-org and cross-org with/without step-up), stale-version
 * conflicts, audit trail, RBAC/org-scoping.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs, setupTotpAndStepUp } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

describe('Admin Control Center — Shift Correction Center', () => {
  const fx = new TestFixtures();
  let orgA: string, orgB: string;
  let storeA: string, storeB: string, storeA2: string;
  let adminA: { id: number; telegramId: number; telegramGrantToken?: string };
  let managerA: { id: number; telegramId: number; telegramGrantToken?: string };
  let employeeA: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Shift Correction Org A');
    orgB = await fx.createOrg('Shift Correction Org B');
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

  async function seedShift(storeId: string, orgId: string, workDate: string, status: 'open' | 'closed' | 'auto_closed' = 'closed') {
    const res = await query(
      `INSERT INTO shift_sessions (employee_id, store_id, work_date, status, org_id, closed_at)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $4 = 'open' THEN NULL ELSE now() END)
       RETURNING *`,
      [employeeA.id, storeId, workDate, status, orgId]
    );
    return res.rows[0];
  }

  it('non-admin (manager/employee) is blocked from every /admin/shifts/* route', async () => {
    const app = await getApp();
    const row = await seedShift(storeA, orgA, '2024-03-10');
    for (const url of [`/admin/shifts`, `/admin/shifts/${row.id}`]) {
      const resManager = await app.inject({ method: 'GET', url, headers: authAs(managerA.telegramId) });
      expect(resManager.statusCode).toBe(403);
      const resEmployee = await app.inject({ method: 'GET', url, headers: authAs(employeeA.telegramId) });
      expect(resEmployee.statusCode).toBe(403);
    }
    const voidManager = await app.inject({
      method: 'POST', url: `/admin/shifts/${row.id}/void`,
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { version: row.version, reason: 'test' }
    });
    expect(voidManager.statusCode).toBe(403);
  });

  it('void requires a reason and rejects an open session', async () => {
    const app = await getApp();
    const row = await seedShift(storeA, orgA, '2024-03-11', 'open');

    const missingReason = await app.inject({
      method: 'POST', url: `/admin/shifts/${row.id}/void`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: row.version }
    });
    expect(missingReason.statusCode).toBe(400);

    const openRejected = await app.inject({
      method: 'POST', url: `/admin/shifts/${row.id}/void`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: row.version, reason: 'смена ещё открыта' }
    });
    expect(openRejected.statusCode).toBe(400);
  });

  it('void succeeds on a closed session and writes SHIFT_VOIDED audit', async () => {
    const app = await getApp();
    const row = await seedShift(storeA, orgA, '2024-03-12', 'closed');
    const res = await app.inject({
      method: 'POST', url: `/admin/shifts/${row.id}/void`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: row.version, reason: 'ошибочная смена' }
    });
    expect(res.statusCode).toBe(200);
    const voided = res.json().row;
    expect(voided.voided_at).toBeTruthy();
    expect(Number(voided.version)).toBe(Number(row.version) + 1);

    const audit = await query(
      `SELECT * FROM audit_log WHERE action = 'SHIFT_VOIDED' AND target_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [String(row.id)]
    );
    expect(audit.rows[0]).toBeTruthy();
    expect(audit.rows[0].after.reason).toBe('ошибочная смена');
  });

  it('double-void is rejected', async () => {
    const app = await getApp();
    const row = await seedShift(storeA, orgA, '2024-03-13', 'closed');
    const first = await app.inject({
      method: 'POST', url: `/admin/shifts/${row.id}/void`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: row.version, reason: 'причина' }
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: 'POST', url: `/admin/shifts/${row.id}/void`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: first.json().row.version, reason: 'причина ещё раз' }
    });
    expect(second.statusCode).toBe(400);
  });

  it('a stale version on void is rejected with a conflict', async () => {
    const app = await getApp();
    const row = await seedShift(storeA, orgA, '2024-03-14', 'closed');
    const res = await app.inject({
      method: 'POST', url: `/admin/shifts/${row.id}/void`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: Number(row.version) + 99, reason: 'stale' }
    });
    expect(res.statusCode).toBe(409);
  });

  it('restore un-voids and writes SHIFT_RESTORED audit', async () => {
    const app = await getApp();
    const row = await seedShift(storeA, orgA, '2024-03-15', 'closed');
    const voidRes = await app.inject({
      method: 'POST', url: `/admin/shifts/${row.id}/void`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: row.version, reason: 'ошибка' }
    });
    const voided = voidRes.json().row;

    const restore = await app.inject({
      method: 'POST', url: `/admin/shifts/${row.id}/restore`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: voided.version, reason: 'подтверждена корректной' }
    });
    expect(restore.statusCode).toBe(200);
    expect(restore.json().row.voided_at).toBeFalsy();

    const audit = await query(
      `SELECT * FROM audit_log WHERE action = 'SHIFT_RESTORED' AND target_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [String(row.id)]
    );
    expect(audit.rows[0]).toBeTruthy();
  });

  it('restoring a non-voided session is rejected', async () => {
    const app = await getApp();
    const row = await seedShift(storeA, orgA, '2024-03-16', 'closed');
    const res = await app.inject({
      method: 'POST', url: `/admin/shifts/${row.id}/restore`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: row.version, reason: 'x' }
    });
    expect(res.statusCode).toBe(400);
  });

  it('correct within the same org succeeds without step-up and recomputes nothing (org unchanged)', async () => {
    const app = await getApp();
    const row = await seedShift(storeA, orgA, '2024-03-17', 'closed');
    const res = await app.inject({
      method: 'POST', url: `/admin/shifts/${row.id}/correct`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: row.version, new_store_id: storeA2, reason: 'сотрудник отработал на другой точке сети' }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().row.store_id).toBe(storeA2);
    expect(res.json().row.org_id).toBe(orgA);

    const audit = await query(
      `SELECT * FROM audit_log WHERE action = 'SHIFT_CORRECTED' AND target_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [String(row.id)]
    );
    expect(audit.rows[0].before.store_id).toBe(storeA);
    expect(audit.rows[0].after.store_id).toBe(storeA2);
  });

  it('cross-org correct is rejected without step-up and succeeds with it, recomputing org_id', async () => {
    const app = await getApp();
    const row = await seedShift(storeA, orgA, '2024-03-18', 'closed');

    const withoutStepUp = await app.inject({
      method: 'POST', url: `/admin/shifts/${row.id}/correct`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: row.version, new_store_id: storeB, reason: 'перенос в другую сеть' }
    });
    expect(withoutStepUp.statusCode).toBe(403);
    expect(withoutStepUp.json().error).toBe('step_up_required');

    const stepUpHeaders = await setupTotpAndStepUp(adminA.id, authAs(adminA.telegramId));
    const withStepUp = await app.inject({
      method: 'POST', url: `/admin/shifts/${row.id}/correct`,
      headers: { ...authAs(adminA.telegramId), ...stepUpHeaders, 'content-type': 'application/json' },
      payload: { version: row.version, new_store_id: storeB, reason: 'перенос в другую сеть' }
    });
    expect(withStepUp.statusCode).toBe(200);
    expect(withStepUp.json().row.store_id).toBe(storeB);
    expect(withStepUp.json().row.org_id).toBe(orgB);
  });

  it('a stale version on correct is rejected with a conflict', async () => {
    const app = await getApp();
    const row = await seedShift(storeA, orgA, '2024-03-19', 'closed');
    const res = await app.inject({
      method: 'POST', url: `/admin/shifts/${row.id}/correct`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: Number(row.version) + 99, new_store_id: storeA2, reason: 'x' }
    });
    expect(res.statusCode).toBe(409);
  });

  it('GET /admin/shifts is org-scoped — admin of org A does not see org B rows by default', async () => {
    const app = await getApp();
    await seedShift(storeA, orgA, '2024-03-20');
    const res = await app.inject({ method: 'GET', url: '/admin/shifts', headers: authAs(adminA.telegramId, adminA.telegramGrantToken) });
    expect(res.statusCode).toBe(200);
    const items = res.json().items;
    expect(items.every((i: any) => i.org_id === orgA)).toBe(true);
  });
});
