/**
 * Admin Control Center (20.59.0) — Employee admin: role change (audited,
 * no self-escalation shortcut beyond canAssignRole, MFA-mandatory
 * escalation requires step-up), session revoke, RBAC.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs, setupTotpAndStepUp } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import * as sessionsRepo from '../../src/data/repositories/sessions.js';

describe('Admin Control Center — Employees', () => {
  const fx = new TestFixtures();
  let orgA: string;
  let adminA: { id: number; telegramId: number; telegramGrantToken?: string };
  let managerA: { id: number; telegramId: number };
  let employeeA: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Admin Employees Org A');
    adminA = await fx.createEmployee(orgA, { role: 'admin' });
    managerA = await fx.createEmployee(orgA, { role: 'manager' });
    employeeA = await fx.createEmployee(orgA, { role: 'employee' });
  });

  afterAll(async () => {
    await query(`DELETE FROM audit_log WHERE org_id = $1`, [orgA]);
    await fx.cleanup();
  });

  it('non-admin is blocked from /admin/employees/*', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: `/admin/employees/${employeeA.id}`, headers: authAs(managerA.telegramId) });
    expect(res.statusCode).toBe(403);
  });

  it('GET /admin/employees/:id returns profile and sessions', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: `/admin/employees/${employeeA.id}`, headers: authAs(adminA.telegramId, adminA.telegramGrantToken) });
    expect(res.statusCode).toBe(200);
    expect(Number(res.json().employee.id)).toBe(employeeA.id);
    expect(Array.isArray(res.json().sessions)).toBe(true);
  });

  it('role change to a non-MFA-mandatory role is audited without needing step-up', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST', url: `/admin/employees/${employeeA.id}/role`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { role: 'senior' }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().employee.role).toBe('senior');

    const audit = await query(
      `SELECT * FROM audit_log WHERE action = 'admin.employee_role_change' AND target_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [String(employeeA.id)]
    );
    expect(audit.rows[0].before.role).toBe('employee');
    expect(audit.rows[0].after.role).toBe('senior');
  });

  it('escalating to an MFA-mandatory role without step-up is rejected', async () => {
    const app = await getApp();
    const target = await fx.createEmployee(orgA, { role: 'employee' });
    const res = await app.inject({
      method: 'POST', url: `/admin/employees/${target.id}/role`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { role: 'admin' }
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('step_up_required');
  });

  it('escalating to an MFA-mandatory role with step-up succeeds', async () => {
    const app = await getApp();
    const target = await fx.createEmployee(orgA, { role: 'employee' });
    const stepUpHeaders = await setupTotpAndStepUp(adminA.id, authAs(adminA.telegramId));
    const res = await app.inject({
      method: 'POST', url: `/admin/employees/${target.id}/role`,
      headers: { ...authAs(adminA.telegramId), ...stepUpHeaders, 'content-type': 'application/json' },
      payload: { role: 'admin' }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().employee.role).toBe('admin');
  });

  it('revoking one session removes exactly that session, not others', async () => {
    const app = await getApp();
    const target = await fx.createEmployee(orgA, { role: 'employee' });
    const token1 = await sessionsRepo.createSession(target.id);
    const token2 = await sessionsRepo.createSession(target.id);
    const before = await sessionsRepo.listForEmployee(target.id);
    expect(before.length).toBe(2);

    const res = await app.inject({
      method: 'DELETE', url: `/admin/employees/${target.id}/sessions/${before[0].id}`,
      headers: authAs(adminA.telegramId, adminA.telegramGrantToken)
    });
    expect(res.statusCode).toBe(200);
    const after = await sessionsRepo.listForEmployee(target.id);
    expect(after.length).toBe(1);
    expect(after[0].id).not.toBe(before[0].id);
  });

  it('revoke-all removes every session for the employee', async () => {
    const app = await getApp();
    const target = await fx.createEmployee(orgA, { role: 'employee' });
    await sessionsRepo.createSession(target.id);
    await sessionsRepo.createSession(target.id);
    const res = await app.inject({
      method: 'POST', url: `/admin/employees/${target.id}/sessions/revoke-all`,
      headers: authAs(adminA.telegramId, adminA.telegramGrantToken)
    });
    expect(res.statusCode).toBe(200);
    const after = await sessionsRepo.listForEmployee(target.id);
    expect(after.length).toBe(0);
  });

  it('MFA reset requires step-up', async () => {
    const app = await getApp();
    const target = await fx.createEmployee(orgA, { role: 'employee' });
    const withoutStepUp = await app.inject({
      method: 'POST', url: `/admin/employees/${target.id}/mfa/reset`,
      headers: authAs(adminA.telegramId, adminA.telegramGrantToken)
    });
    expect(withoutStepUp.statusCode).toBe(403);
  });
});
