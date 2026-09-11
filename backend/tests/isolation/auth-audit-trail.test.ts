import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAsSession } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { hashPassword } from '../../src/auth/password.js';
import { query } from '../../src/data/db/index.js';

/**
 * Security audit finding (17-layer hardening pass, Layer 7 — Журнал
 * аудита): the most auth-sensitive events — login success/failure,
 * logout, session revocation, access-request approve/reject — left NO
 * audit_log trace at all before this. RUNBOOK.md's compromise-response
 * procedure already assumes `SELECT * FROM audit_log WHERE target_id=<ID>`
 * can reconstruct what happened during a suspected compromise window —
 * this test proves that query now actually has something to find for
 * each of those event classes.
 */
describe('Audit trail — login/logout/session-revoke/access-approve-reject now leave audit_log entries', () => {
  const fx = new TestFixtures();
  const rawAccessRequestOrgIds: string[] = [];
  afterAll(async () => {
    // These two access_requests rows are inserted directly by this file
    // (not via TestFixtures, which has no access-request helper) — clean
    // them up before fx.cleanup() deletes the orgs, or the FK blocks it.
    if (rawAccessRequestOrgIds.length) {
      await query(`DELETE FROM access_requests WHERE org_id = ANY($1)`, [rawAccessRequestOrgIds]);
    }
    await fx.cleanup();
  });

  async function lastAuditAction(employeeId: number, action: string): Promise<any> {
    const res = await query(
      `SELECT * FROM audit_log WHERE target_id = $1 AND action = $2 ORDER BY created_at DESC LIMIT 1`,
      [String(employeeId), action]
    );
    return res.rows[0] || null;
  }

  it('POST /auth/login — success and failure both write audit_log rows', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Audit Login Org');
    const passwordHash = await hashPassword('correct-horse-battery');
    const phone = `+7900${Date.now() % 10000000}`;
    const { id: employeeId } = await fx.createPhoneEmployee(org, phone, passwordHash, { fullName: 'Audit Login Employee' });

    const wrong = await app.inject({ method: 'POST', url: '/auth/login', payload: { phone, password: 'wrong-one' } });
    expect(wrong.statusCode).toBe(401);
    const failRow = await lastAuditAction(employeeId, 'auth.login_failed');
    expect(failRow).toBeTruthy();
    expect(failRow.org_id).toBe(org);

    const right = await app.inject({ method: 'POST', url: '/auth/login', payload: { phone, password: 'correct-horse-battery' } });
    expect(right.statusCode).toBe(200);
    const successRow = await lastAuditAction(employeeId, 'auth.login_success');
    expect(successRow).toBeTruthy();
    expect(successRow.actor_employee_id).toBe(employeeId);
  });

  it('POST /auth/logout — writes an audit_log row when a real session existed', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Audit Logout Org');
    const employee = await fx.createEmployee(org, { role: 'employee' });
    const { createSession } = await import('../../src/data/repositories/sessions.js');
    const token = await createSession(employee.id, false, 'employee');

    const logout = await app.inject({ method: 'POST', url: '/auth/logout', headers: authAsSession(token) });
    expect(logout.statusCode).toBe(200);
    const row = await lastAuditAction(employee.id, 'auth.logout');
    expect(row).toBeTruthy();
  });

  it('DELETE /auth/sessions/:id and POST /auth/sessions/revoke-others — both write audit_log rows', async () => {
    const org = await fx.createOrg('Audit Session Revoke Org');
    const employee = await fx.createEmployee(org, { role: 'employee' });
    const { createSession } = await import('../../src/data/repositories/sessions.js');
    const token1 = await createSession(employee.id, false, 'employee');
    await createSession(employee.id, false, 'employee');

    const app = await getApp();
    const headers = authAsSession(token1);

    const listRes = await app.inject({ method: 'GET', url: '/auth/sessions', headers });
    const sessions = listRes.json().sessions as { id: number; current: boolean }[];
    const other = sessions.find((s) => !s.current)!;

    const del = await app.inject({ method: 'DELETE', url: `/auth/sessions/${other.id}`, headers });
    expect(del.statusCode).toBe(200);
    expect(await lastAuditAction(employee.id, 'auth.session_revoked')).toBeTruthy();

    const revokeOthers = await app.inject({ method: 'POST', url: '/auth/sessions/revoke-others', headers });
    expect(revokeOthers.statusCode).toBe(200);
    expect(await lastAuditAction(employee.id, 'auth.session_revoked_others')).toBeTruthy();
  });

  it('POST /access/requests/:id/approve and /reject — both write audit_log rows', async () => {
    const org = await fx.createOrg('Audit Access Approve Org');
    rawAccessRequestOrgIds.push(org);
    const manager = await fx.createEmployee(org, { role: 'manager' });
    const app = await getApp();
    const { authAs } = await import('../helpers/app.js');

    const req1 = await query(
      `INSERT INTO access_requests (full_name, telegram_id, org_id, status, provider) VALUES ('Approve Me', $1, $2, 'pending', 'telegram') RETURNING id`,
      [Math.floor(9_000_000_000 + Math.random() * 900_000_000), org]
    );
    const approve = await app.inject({
      method: 'POST',
      url: `/access/requests/${req1.rows[0].id}/approve`,
      headers: { ...authAs(manager.telegramId), 'content-type': 'application/json' },
      payload: {}
    });
    expect(approve.statusCode).toBe(200);
    const approvedEmployeeId = approve.json().employee_id;
    fx.employeeIds.push(approvedEmployeeId);
    const approveRow = await lastAuditAction(approvedEmployeeId, 'access_request.approve');
    expect(approveRow).toBeTruthy();

    const req2 = await query(
      `INSERT INTO access_requests (full_name, telegram_id, org_id, status, provider) VALUES ('Reject Me', $1, $2, 'pending', 'telegram') RETURNING id`,
      [Math.floor(9_000_000_000 + Math.random() * 900_000_000), org]
    );
    const reject = await app.inject({
      method: 'POST',
      url: `/access/requests/${req2.rows[0].id}/reject`,
      headers: { ...authAs(manager.telegramId), 'content-type': 'application/json' },
      payload: {}
    });
    expect(reject.statusCode).toBe(200);
    const rejectRes = await query(
      `SELECT * FROM audit_log WHERE target_id = $1 AND action = 'access_request.reject' ORDER BY created_at DESC LIMIT 1`,
      [String(req2.rows[0].id)]
    );
    expect(rejectRes.rows[0]).toBeTruthy();
  });
});
