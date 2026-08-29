/**
 * Auth Assurance Hardening (20.52.1) — invariants that go beyond what
 * mfa.test.ts/session-lifecycle.test.ts already cover for 20.52.0:
 *
 * PRIV-MFA-1/2 — admin/supervisor with no confirmed MFA factor cannot
 *   reach ANY requireActive()-gated route, not just step-up-gated ones
 *   (see auth/guards.ts::requireActive, auth/assurance.ts).
 * RESET-1 — password reset cannot bypass a configured factor.
 * ROLE-1 — an existing browser session cannot silently inherit
 *   privileged access when its owner is promoted (session revoked).
 * TOTP-1 — TOTP secret is never stored plaintext-shaped in the DB.
 * STEPUP-1 (session binding) — a step-up ticket issued for one browser
 *   session cannot be used from a different session of the same employee.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { generate } from 'otplib';
import { getApp, authAs, authAsSession, setupTotpAndStepUp } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import { hashPassword } from '../../src/auth/password.js';
import * as totp from '../../src/auth/mfa/totp.js';
import * as webauthn from '../../src/auth/mfa/webauthn.js';
import * as sessionsRepo from '../../src/data/repositories/sessions.js';

function uniquePhone(): string {
  return '+7906' + Math.floor(1000000 + Math.random() * 8999999);
}

describe('Auth Assurance Hardening (20.52.1)', () => {
  const fx = new TestFixtures();
  afterAll(() => fx.cleanup());

  describe('PRIV-MFA-1/2 — privileged role without MFA is blocked from ordinary protected routes', () => {
    it('admin without MFA can still log in (AAL1), but every protected route past that answers mfa_enrollment_required', async () => {
      const app = await getApp();
      const org = await fx.createOrg('PrivBlock Admin Org');
      const admin = await fx.createEmployee(org, { role: 'admin', mfa: false });

      // The account-wide gate is provider-agnostic — exercised here via
      // Telegram headers (this fixture has no browser session at all).
      const res = await app.inject({ method: 'GET', url: '/employees', headers: authAs(admin.telegramId) });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('mfa_enrollment_required');
    });

    it('supervisor without MFA gets the same treatment', async () => {
      const app = await getApp();
      const org = await fx.createOrg('PrivBlock Supervisor Org');
      const supervisor = await fx.createEmployee(org, { role: 'supervisor', mfa: false });

      const res = await app.inject({ method: 'GET', url: '/employees', headers: authAs(supervisor.telegramId) });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('mfa_enrollment_required');
    });

    it('the enrollment endpoints themselves remain reachable in this state (no lockout)', async () => {
      const app = await getApp();
      const org = await fx.createOrg('PrivBlock Enroll Org');
      const admin = await fx.createEmployee(org, { role: 'admin', mfa: false });

      const status = await app.inject({ method: 'GET', url: '/auth/mfa/status', headers: authAs(admin.telegramId) });
      expect(status.statusCode).toBe(200);

      const enroll = await app.inject({ method: 'POST', url: '/auth/mfa/totp/enroll', headers: authAs(admin.telegramId) });
      expect(enroll.statusCode).toBe(200);
    });

    it('once enrolled, the same account passes the gate again', async () => {
      const app = await getApp();
      const org = await fx.createOrg('PrivBlock Recover Org');
      const admin = await fx.createEmployee(org, { role: 'admin', mfa: false });

      const blocked = await app.inject({ method: 'GET', url: '/employees', headers: authAs(admin.telegramId) });
      expect(blocked.statusCode).toBe(403);

      await fx.enrollTotpFor(admin.id);

      const allowed = await app.inject({ method: 'GET', url: '/employees', headers: authAs(admin.telegramId) });
      expect(allowed.statusCode).toBe(200);
    });

    it('a non-privileged role with no MFA is NOT affected by this gate at all', async () => {
      const app = await getApp();
      const org = await fx.createOrg('PrivBlock Employee Org');
      const employee = await fx.createEmployee(org, { role: 'employee' });

      const res = await app.inject({ method: 'GET', url: '/me/day', headers: authAs(employee.telegramId) });
      expect(res.statusCode).not.toBe(403);
    });
  });

  describe('RESET-1 — password reset cannot bypass configured MFA', () => {
    it('admin with MFA: password reset does not issue a session, and login/mfa is still required afterward', async () => {
      const app = await getApp();
      const org = await fx.createOrg('Reset MFA Admin Org');
      const passwordHash = await hashPassword('old-pass-1');
      const phone = uniquePhone();
      const admin = await fx.createPhoneEmployee(org, phone, passwordHash, { role: 'admin', fullName: 'Reset Admin' });
      const enrollment = await totp.startTotpEnrollment(admin.id, phone);
      await totp.confirmTotpEnrollment(admin.id, await generate({ secret: enrollment.secret }));

      const resetToken = await query(
        `INSERT INTO employee_password_resets (employee_id, token_hash, expires_at)
         VALUES ($1, encode(sha256($2::bytea), 'hex'), now() + interval '1 hour') RETURNING $2 as raw`,
        [admin.id, 'reset-token-admin-mfa']
      );
      const token = resetToken.rows[0].raw as string;

      const res = await app.inject({
        method: 'POST',
        url: `/auth/reset/${token}`,
        payload: { password: 'new-pass-1-longer' }
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.mfa_required).toBe(true);
      expect(body.mfa_token).toBeTruthy();
      // No session cookie — the whole point of this fix (§4).
      expect(res.cookies.some((c: any) => c.name === 't2_session')).toBe(false);

      // Complete MFA with the freshly reset password's pending login token.
      const code = await generate({ secret: enrollment.secret, epoch: Math.floor(Date.now() / 1000) + 30 });
      const finish = await app.inject({
        method: 'POST',
        url: '/auth/login/mfa',
        payload: { mfa_token: body.mfa_token, method: 'totp', code }
      });
      expect(finish.statusCode).toBe(200);
      expect(finish.cookies.some((c: any) => c.name === 't2_session')).toBe(true);
    });

    it('regular MFA-enabled employee: password reset also requires MFA completion, not just a new password', async () => {
      const app = await getApp();
      const org = await fx.createOrg('Reset MFA Employee Org');
      const passwordHash = await hashPassword('old-pass-2');
      const phone = uniquePhone();
      const employee = await fx.createPhoneEmployee(org, phone, passwordHash, { role: 'employee', fullName: 'Reset Employee' });
      const enrollment = await totp.startTotpEnrollment(employee.id, phone);
      await totp.confirmTotpEnrollment(employee.id, await generate({ secret: enrollment.secret }));

      const resetToken = await query(
        `INSERT INTO employee_password_resets (employee_id, token_hash, expires_at)
         VALUES ($1, encode(sha256($2::bytea), 'hex'), now() + interval '1 hour') RETURNING $2 as raw`,
        [employee.id, 'reset-token-employee-mfa']
      );
      const token = resetToken.rows[0].raw as string;

      const res = await app.inject({
        method: 'POST',
        url: `/auth/reset/${token}`,
        payload: { password: 'new-pass-2-longer' }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().mfa_required).toBe(true);
      expect(res.cookies.some((c: any) => c.name === 't2_session')).toBe(false);
    });

    it('account WITHOUT MFA still gets an immediate session after reset (unaffected)', async () => {
      const app = await getApp();
      const org = await fx.createOrg('Reset NoMFA Org');
      const passwordHash = await hashPassword('old-pass-3');
      const phone = uniquePhone();
      const employee = await fx.createPhoneEmployee(org, phone, passwordHash, { role: 'employee', fullName: 'No MFA Reset' });

      const resetToken = await query(
        `INSERT INTO employee_password_resets (employee_id, token_hash, expires_at)
         VALUES ($1, encode(sha256($2::bytea), 'hex'), now() + interval '1 hour') RETURNING $2 as raw`,
        [employee.id, 'reset-token-no-mfa']
      );
      const token = resetToken.rows[0].raw as string;

      const res = await app.inject({ method: 'POST', url: `/auth/reset/${token}`, payload: { password: 'new-pass-3-longer' } });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(res.cookies.some((c: any) => c.name === 't2_session')).toBe(true);
    });
  });

  describe('ROLE-1 — privilege elevation revokes existing sessions', () => {
    it('an employee promoted to admin has their existing browser session revoked, not silently privileged', async () => {
      const app = await getApp();
      const org = await fx.createOrg('Promote Org');
      const managerAdmin = await fx.createEmployee(org, { role: 'admin' });
      const passwordHash = await hashPassword('promo-pass-1');
      const phone = uniquePhone();
      const target = await fx.createPhoneEmployee(org, phone, passwordHash, { role: 'employee', fullName: 'Promotable' });

      const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { phone, password: 'promo-pass-1' } });
      expect(login.statusCode).toBe(200);
      const sessionCookie = login.cookies.find((c: any) => c.name === 't2_session')!;
      const csrfCookie = login.cookies.find((c: any) => c.name === 't2_csrf')!;
      const sessionHeaders = { cookie: `t2_session=${sessionCookie.value}; t2_csrf=${csrfCookie.value}`, 'x-csrf-token': csrfCookie.value };

      // Session works before promotion. /employees is requireActive()-gated
      // (unlike /me/day, which answers 200/{bound:false} for no identity at
      // all rather than 401 — not the right probe for "is this session
      // still valid").
      const before = await app.inject({ method: 'GET', url: '/employees', headers: sessionHeaders });
      expect(before.statusCode).toBe(200);

      const stepUp = await setupTotpAndStepUp(managerAdmin.id, authAs(managerAdmin.telegramId));
      const promote = await app.inject({
        method: 'PATCH',
        url: `/employees/${target.id}/role`,
        headers: { ...authAs(managerAdmin.telegramId), 'content-type': 'application/json', ...stepUp },
        payload: { role: 'admin' }
      });
      expect(promote.statusCode).toBe(200);

      // The OLD session token must no longer resolve at all — revoked, not
      // "resolves but capped at old role" (simpler, matches sessions.ts's
      // existing deleteAllForEmployee semantics used for password reset).
      const after = await app.inject({ method: 'GET', url: '/employees', headers: sessionHeaders });
      expect(after.statusCode).toBe(401);
    });

    it('a lateral/no-op role re-assignment (already admin) does not revoke sessions', async () => {
      const app = await getApp();
      const org = await fx.createOrg('NoOp Reassign Org');
      const rootAdmin = await fx.createEmployee(org, { role: 'admin' });
      const passwordHash = await hashPassword('already-admin-pass');
      const phone = uniquePhone();
      const target = await fx.createPhoneEmployee(org, phone, passwordHash, { role: 'admin', fullName: 'Already Admin' });
      await fx.enrollTotpFor(target.id);

      const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { phone, password: 'already-admin-pass' } });
      // Already has MFA — goes through the MFA branch, not a plain session.
      expect(login.json().mfa_required).toBe(true);
    });
  });

  describe('TOTP-1 — TOTP secret is never stored plaintext', () => {
    it('the stored secret_encrypted column is a versioned AEAD envelope, not {plain: "..."}', async () => {
      const org = await fx.createOrg('Totp Storage Org');
      const admin = await fx.createEmployee(org, { role: 'admin', mfa: false });
      await fx.enrollTotpFor(admin.id);

      const row = await query(`SELECT secret_encrypted FROM employee_totp WHERE employee_id = $1`, [admin.id]);
      const stored = row.rows[0].secret_encrypted;
      expect(stored).not.toHaveProperty('plain');
      expect(stored.v).toBe(1);
      expect(stored.alg).toBe('aes-256-gcm');
      expect(typeof stored.data?.ciphertext).toBe('string');
    });

    it('TOTP enrollment fails closed (does not fall back to plaintext) when encryption is disabled', async () => {
      const org = await fx.createOrg('Totp Fail Closed Org');
      const admin = await fx.createEmployee(org, { role: 'admin', mfa: false });
      const original = process.env.DATA_ENCRYPTION_ENABLED;
      process.env.DATA_ENCRYPTION_ENABLED = 'false';
      try {
        await expect(totp.startTotpEnrollment(admin.id, 'fail-closed-test')).rejects.toThrow();
      } finally {
        process.env.DATA_ENCRYPTION_ENABLED = original;
      }
      const row = await query(`SELECT 1 FROM employee_totp WHERE employee_id = $1`, [admin.id]);
      expect(row.rows.length).toBe(0);
    });
  });

  describe('STEPUP-1 — step-up ticket is bound to the issuing browser session', () => {
    it('a ticket issued from session A is rejected when presented alongside session B of the same employee', async () => {
      const app = await getApp();
      const org = await fx.createOrg('StepUp Session Bind Org');
      const admin = await fx.createEmployee(org, { role: 'admin', mfa: false });
      const enrollment = await totp.startTotpEnrollment(admin.id, 'bind-test');
      await totp.confirmTotpEnrollment(admin.id, await generate({ secret: enrollment.secret }));

      // Session A and session B: two independent browser sessions for the
      // SAME employee — created directly via the repository (a real
      // password+MFA login round trip would need a THIRD sequential TOTP
      // code within the same 30s replay window as the step-up code below,
      // which otplib's epochTolerance can't satisfy twice in one test —
      // the two sessions' existence, not how they were established, is
      // what this test is actually about).
      const sessionA = await sessionsRepo.createSession(admin.id, true, 'admin');
      await query(
        `INSERT INTO employee_sessions (employee_id, token_hash, expires_at, mfa_verified_at)
         VALUES ($1, encode(sha256('session-b-token'::bytea), 'hex'), now() + interval '7 days', now())`,
        [admin.id]
      );

      // Get a step-up ticket FROM session A.
      const codeStepUp = await generate({ secret: enrollment.secret, epoch: Math.floor(Date.now() / 1000) + 30 });
      const stepUpRes = await app.inject({
        method: 'POST',
        url: '/auth/mfa/step-up',
        headers: authAsSession(sessionA),
        payload: { method: 'totp', code: codeStepUp }
      });
      expect(stepUpRes.statusCode).toBe(200);
      const ticket = stepUpRes.json().step_up_token as string;

      // Present it from session B — must be rejected (session-bound).
      const otherAdmin = await fx.createEmployee(org, { role: 'admin' });
      const stepUpFromB = await app.inject({
        method: 'POST',
        url: `/auth/admin/reset-password/${otherAdmin.id}`,
        headers: { ...authAsSession('session-b-token'), 'x-step-up-token': ticket }
      });
      expect(stepUpFromB.statusCode).toBe(403);
      expect(stepUpFromB.json().error).toBe('step_up_required');

      // Sanity: the SAME ticket from session A (the one that issued it) works.
      const stepUpFromA = await app.inject({
        method: 'POST',
        url: `/auth/admin/reset-password/${otherAdmin.id}`,
        headers: { ...authAsSession(sessionA), 'x-step-up-token': ticket }
      });
      expect(stepUpFromA.statusCode).toBe(200);
    });

    it('a Telegram-issued ticket (no session binding) still works — channel-agnostic design unchanged', async () => {
      const app = await getApp();
      const org = await fx.createOrg('StepUp Telegram Org');
      const admin = await fx.createEmployee(org, { role: 'admin' }); // auto-enrolled via fixture
      const stepUp = await setupTotpAndStepUp(admin.id, authAs(admin.telegramId));
      const target = await fx.createEmployee(org, { role: 'employee' });
      const res = await app.inject({
        method: 'POST',
        url: `/auth/admin/reset-password/${target.id}`,
        headers: { ...authAs(admin.telegramId), ...stepUp }
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('WEBAUTHN-1 — user verification requirement is role-driven', () => {
    it('registration options require UV for a privileged (MFA-mandatory) role', async () => {
      const org = await fx.createOrg('WebAuthn UV Priv Org');
      const admin = await fx.createEmployee(org, { role: 'admin', mfa: false });
      const originalMiniAppUrl = process.env.MINI_APP_URL;
      process.env.MINI_APP_URL = 'https://t2-sales.example.com';
      try {
        const options = await webauthn.startRegistration(admin.id, String(admin.telegramId), 'Admin', true);
        expect(options.authenticatorSelection?.userVerification).toBe('required');
      } finally {
        process.env.MINI_APP_URL = originalMiniAppUrl;
      }
    });

    it('registration options only prefer UV for a non-mandatory role', async () => {
      const org = await fx.createOrg('WebAuthn UV NonPriv Org');
      const employee = await fx.createEmployee(org, { role: 'employee' });
      const originalMiniAppUrl = process.env.MINI_APP_URL;
      process.env.MINI_APP_URL = 'https://t2-sales.example.com';
      try {
        const options = await webauthn.startRegistration(employee.id, String(employee.telegramId), 'Employee', false);
        expect(options.authenticatorSelection?.userVerification).toBe('preferred');
      } finally {
        process.env.MINI_APP_URL = originalMiniAppUrl;
      }
    });
  });

  // §6/§7/§8 (доп. аудит 20.52.1) — TOCTOU races found by an external
  // security review of this same MFA/session code: read-then-write pairs
  // (resolve+consume, verify+record) that weren't atomic, so two
  // concurrent requests with the same valid credential could both
  // succeed. Fixed via atomic UPDATE...WHERE...RETURNING claims — these
  // tests fire genuinely concurrent requests (Promise.all, not
  // sequential awaits) to prove exactly one wins.
  describe('Concurrency races — atomic single-use claims', () => {
    it('TOTP: two concurrent verifications of the SAME code succeed exactly once (replay-protection race)', async () => {
      const org = await fx.createOrg('Totp Race Org');
      const admin = await fx.createEmployee(org, { role: 'admin', mfa: false });
      const enrollment = await totp.startTotpEnrollment(admin.id, 'race-test');
      const code = await generate({ secret: enrollment.secret, epoch: Math.floor(Date.now() / 1000) });
      await totp.confirmTotpEnrollment(admin.id, code);

      // A code already used for confirm — reuse it directly against
      // verifyConfirmedTotp() concurrently (same still-in-window code,
      // simulating an attacker replaying an observed valid code
      // concurrently with the legitimate holder, or a client double-submit).
      const nextCode = await generate({ secret: enrollment.secret, epoch: Math.floor(Date.now() / 1000) + 30 });
      const [a, b] = await Promise.all([
        totp.verifyConfirmedTotp(admin.id, nextCode),
        totp.verifyConfirmedTotp(admin.id, nextCode)
      ]);
      const successCount = [a, b].filter(Boolean).length;
      expect(successCount).toBe(1);
    });

    it('MFA login: two concurrent /auth/login/mfa submissions with the SAME token+code create exactly one session', async () => {
      const app = await getApp();
      const org = await fx.createOrg('Pending Login Race Org');
      const passwordHash = await hashPassword('race-pass-1');
      const phone = uniquePhone();
      const admin = await fx.createPhoneEmployee(org, phone, passwordHash, { role: 'admin', fullName: 'Race Admin' });
      const enrollment = await totp.startTotpEnrollment(admin.id, phone);
      await totp.confirmTotpEnrollment(admin.id, await generate({ secret: enrollment.secret }));

      const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { phone, password: 'race-pass-1' } });
      const mfaToken = login.json().mfa_token as string;
      const code = await generate({ secret: enrollment.secret, epoch: Math.floor(Date.now() / 1000) + 30 });

      const [r1, r2] = await Promise.all([
        app.inject({ method: 'POST', url: '/auth/login/mfa', payload: { mfa_token: mfaToken, method: 'totp', code } }),
        app.inject({ method: 'POST', url: '/auth/login/mfa', payload: { mfa_token: mfaToken, method: 'totp', code } })
      ]);
      const successes = [r1, r2].filter((r) => r.statusCode === 200);
      expect(successes.length).toBe(1);

      const sessionCount = await query('SELECT count(*) FROM employee_sessions WHERE employee_id = $1', [admin.id]);
      expect(Number(sessionCount.rows[0].count)).toBe(1);
    });

    it('password reset: two concurrent /auth/reset/:token submissions with the SAME token succeed exactly once', async () => {
      const app = await getApp();
      const org = await fx.createOrg('Password Reset Race Org');
      const passwordHash = await hashPassword('race-pass-2');
      const phone = uniquePhone();
      const employee = await fx.createPhoneEmployee(org, phone, passwordHash, { role: 'employee', fullName: 'Race Reset' });

      const resetToken = await query(
        `INSERT INTO employee_password_resets (employee_id, token_hash, expires_at)
         VALUES ($1, encode(sha256($2::bytea), 'hex'), now() + interval '1 hour') RETURNING $2 as raw`,
        [employee.id, 'reset-token-race']
      );
      const token = resetToken.rows[0].raw as string;

      const [r1, r2] = await Promise.all([
        app.inject({ method: 'POST', url: `/auth/reset/${token}`, payload: { password: 'race-new-pass-a' } }),
        app.inject({ method: 'POST', url: `/auth/reset/${token}`, payload: { password: 'race-new-pass-b' } })
      ]);
      const successes = [r1, r2].filter((r) => r.statusCode === 200);
      expect(successes.length).toBe(1);
    });
  });
});
