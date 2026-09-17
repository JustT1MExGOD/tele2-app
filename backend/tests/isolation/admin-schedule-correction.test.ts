/**
 * Admin Control Center, Phase 4+ — Schedule Correction Center: void
 * (version-gated hard delete, no restore), correct (store/date/hours,
 * destination-collision rejected), stale-version conflicts, audit
 * trail, RBAC/org-scoping.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

describe('Admin Control Center — Schedule Correction Center', () => {
  const fx = new TestFixtures();
  let orgA: string;
  let storeA: string, storeA2: string;
  let adminA: { id: number; telegramId: number; telegramGrantToken?: string };
  let managerA: { id: number; telegramId: number; telegramGrantToken?: string };
  let employeeA: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Schedule Correction Org A');
    storeA = await fx.createStore(orgA, 'Store A1');
    storeA2 = await fx.createStore(orgA, 'Store A2');
    adminA = await fx.createEmployee(orgA, { role: 'admin' });
    managerA = await fx.createEmployee(orgA, { role: 'manager' });
    employeeA = await fx.createEmployee(orgA, { role: 'employee' });
  });

  afterAll(async () => {
    await query(`DELETE FROM audit_log WHERE org_id = $1`, [orgA]);
    await fx.cleanup();
  });

  async function seedSchedule(storeId: string, workDate: string, hours = 11) {
    const res = await query(
      `INSERT INTO schedules (employee_id, store_id, work_date, shift_text, hours) VALUES ($1, $2, $3, '10-21', $4) RETURNING *`,
      [employeeA.id, storeId, workDate, hours]
    );
    return res.rows[0];
  }

  it('non-admin (manager/employee) is blocked from every /admin/schedules/* route', async () => {
    const app = await getApp();
    const row = await seedSchedule(storeA, '2024-04-10');
    for (const url of [`/admin/schedules`, `/admin/schedules/${row.id}`]) {
      const resManager = await app.inject({ method: 'GET', url, headers: authAs(managerA.telegramId) });
      expect(resManager.statusCode).toBe(403);
      const resEmployee = await app.inject({ method: 'GET', url, headers: authAs(employeeA.telegramId) });
      expect(resEmployee.statusCode).toBe(403);
    }
    const voidManager = await app.inject({
      method: 'POST', url: `/admin/schedules/${row.id}/void`,
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { version: row.version, reason: 'test' }
    });
    expect(voidManager.statusCode).toBe(403);
  });

  it('void requires a reason, hard-deletes the row, and writes SCHEDULE_VOIDED audit with a full before-snapshot', async () => {
    const app = await getApp();
    const row = await seedSchedule(storeA, '2024-04-11');

    const missingReason = await app.inject({
      method: 'POST', url: `/admin/schedules/${row.id}/void`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: row.version }
    });
    expect(missingReason.statusCode).toBe(400);

    const res = await app.inject({
      method: 'POST', url: `/admin/schedules/${row.id}/void`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: row.version, reason: 'ошибочно внесена смена' }
    });
    expect(res.statusCode).toBe(200);

    const gone = await app.inject({ method: 'GET', url: `/admin/schedules/${row.id}`, headers: authAs(adminA.telegramId, adminA.telegramGrantToken) });
    expect(gone.statusCode).toBe(404);

    const audit = await query(
      `SELECT * FROM audit_log WHERE action = 'SCHEDULE_VOIDED' AND target_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [String(row.id)]
    );
    expect(audit.rows[0]).toBeTruthy();
    expect(audit.rows[0].before.store_id).toBe(storeA);
    expect(audit.rows[0].after.reason).toBe('ошибочно внесена смена');
  });

  it('a stale version on void is rejected with a conflict, not a silent delete', async () => {
    const app = await getApp();
    const row = await seedSchedule(storeA, '2024-04-12');
    const res = await app.inject({
      method: 'POST', url: `/admin/schedules/${row.id}/void`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: Number(row.version) + 99, reason: 'stale' }
    });
    expect(res.statusCode).toBe(409);

    const still = await app.inject({ method: 'GET', url: `/admin/schedules/${row.id}`, headers: authAs(adminA.telegramId, adminA.telegramGrantToken) });
    expect(still.statusCode).toBe(200);
  });

  it('correct updates store/date/hours and writes SCHEDULE_CORRECTED audit', async () => {
    const app = await getApp();
    const row = await seedSchedule(storeA, '2024-04-13');
    const res = await app.inject({
      method: 'POST', url: `/admin/schedules/${row.id}/correct`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: row.version, store_id: storeA2, hours: 8, reason: 'сотрудник отработал на другой точке' }
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json().row;
    expect(updated.store_id).toBe(storeA2);
    expect(Number(updated.hours)).toBe(8);
    expect(Number(updated.version)).toBe(Number(row.version) + 1);

    const audit = await query(
      `SELECT * FROM audit_log WHERE action = 'SCHEDULE_CORRECTED' AND target_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [String(row.id)]
    );
    expect(audit.rows[0].before.store_id).toBe(storeA);
    expect(audit.rows[0].after.store_id).toBe(storeA2);
  });

  it('correct refuses to move a schedule row onto a date the employee already has a shift on', async () => {
    const app = await getApp();
    const row = await seedSchedule(storeA, '2024-04-14');
    await seedSchedule(storeA2, '2024-04-15');
    const res = await app.inject({
      method: 'POST', url: `/admin/schedules/${row.id}/correct`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: row.version, work_date: '2024-04-15', reason: 'x' }
    });
    expect(res.statusCode).toBe(409);
  });

  it('a stale version on correct is rejected with a conflict', async () => {
    const app = await getApp();
    const row = await seedSchedule(storeA, '2024-04-16');
    const res = await app.inject({
      method: 'POST', url: `/admin/schedules/${row.id}/correct`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: Number(row.version) + 99, hours: 5, reason: 'x' }
    });
    expect(res.statusCode).toBe(409);
  });

  it('correct requires a reason', async () => {
    const app = await getApp();
    const row = await seedSchedule(storeA, '2024-04-17');
    const res = await app.inject({
      method: 'POST', url: `/admin/schedules/${row.id}/correct`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { version: row.version, hours: 5 }
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /admin/schedules is org-scoped', async () => {
    const app = await getApp();
    await seedSchedule(storeA, '2024-04-18');
    const res = await app.inject({ method: 'GET', url: '/admin/schedules', headers: authAs(adminA.telegramId, adminA.telegramGrantToken) });
    expect(res.statusCode).toBe(200);
    const items = res.json().items;
    expect(items.every((i: any) => i.store_id === storeA || i.store_id === storeA2)).toBe(true);
  });
});
