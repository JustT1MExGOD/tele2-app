/**
 * 20.52.0 (MFA) — HTTP-level: login-time second factor, step-up ticket
 * issuance/use/expiry, step-up-gated dangerous actions (grant admin,
 * reset another employee's password/MFA), last-factor-removal guard,
 * WebAuthn boundary rejections (malformed response, wrong employee).
 *
 * WebAuthn registration/authentication ceremonies themselves are NOT
 * exercised end-to-end here — @simplewebauthn/server's verify functions
 * need a real (or virtual/software) authenticator response, which this
 * suite does not simulate; that is real, documented test-coverage gap,
 * not something silently skipped (see final report). What IS tested:
 * every server-side boundary check around the ceremony (malformed input,
 * unknown/foreign credential id, "not configured" branch).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { generate } from 'otplib';
import { getApp, authAs, authAsSession, setupTotpAndStepUp } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { hashPassword } from '../../src/auth/password.js';
import * as totp from '../../src/auth/mfa/totp.js';
import * as recoveryCodes from '../../src/auth/mfa/recovery-codes.js';
import * as mfaRepo from '../../src/data/repositories/mfa.js';

function uniquePhone(): string {
  return '+7906' + Math.floor(1000000 + Math.random() * 8999999);
}

describe('MFA — login second factor, step-up, enrollment guards', () => {
  const fx = new TestFixtures();
  afterAll(() => fx.cleanup());

  it('login WITHOUT a confirmed factor issues a real session immediately (backward compatible default)', async () => {
    const app = await getApp();
    const org = await fx.createOrg('MFA None Org');
    const passwordHash = await hashPassword('plain-pass-123');
    const phone = uniquePhone();
    await fx.createPhoneEmployee(org, phone, passwordHash, { fullName: 'No MFA' });

    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { phone, password: 'plain-pass-123' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(res.cookies.some((c: any) => c.name === 't2_session')).toBe(true);
  });

  it('login WITH a confirmed TOTP factor returns mfa_required instead of a session, then completes via /auth/login/mfa', async () => {
    const app = await getApp();
    const org = await fx.createOrg('MFA Required Org');
    const passwordHash = await hashPassword('plain-pass-456');
    const phone = uniquePhone();
    const { id } = await fx.createPhoneEmployee(org, phone, passwordHash, { fullName: 'Has TOTP' });
    const enrollment = await totp.startTotpEnrollment(id, phone);
    await totp.confirmTotpEnrollment(id, await generate({ secret: enrollment.secret }));

    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { phone, password: 'plain-pass-456' } });
    expect(login.statusCode).toBe(200);
    const body = login.json();
    expect(body.mfa_required).toBe(true);
    expect(body.mfa_token).toBeTruthy();
    expect(body.mfa_methods).toContain('totp');
    // Пароль сам по себе НЕ выдал сессию.
    expect(login.cookies.some((c: any) => c.name === 't2_session')).toBe(false);

    const now = Math.floor(Date.now() / 1000);
    const code = await generate({ secret: enrollment.secret, epoch: now + 30 });
    const verify = await app.inject({
      method: 'POST',
      url: '/auth/login/mfa',
      payload: { mfa_token: body.mfa_token, method: 'totp', code }
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.cookies.some((c: any) => c.name === 't2_session')).toBe(true);
  });

  it('a wrong TOTP code at login-mfa is rejected, mfa_token remains usable for a correct retry', async () => {
    const app = await getApp();
    const org = await fx.createOrg('MFA Wrong Code Org');
    const passwordHash = await hashPassword('plain-pass-789');
    const phone = uniquePhone();
    const { id } = await fx.createPhoneEmployee(org, phone, passwordHash, { fullName: 'Wrong Code' });
    const enrollment = await totp.startTotpEnrollment(id, phone);
    await totp.confirmTotpEnrollment(id, await generate({ secret: enrollment.secret }));

    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { phone, password: 'plain-pass-789' } });
    const { mfa_token } = login.json();

    const bad = await app.inject({ method: 'POST', url: '/auth/login/mfa', payload: { mfa_token, method: 'totp', code: '000000' } });
    expect(bad.statusCode).toBe(401);
    expect(bad.cookies.some((c: any) => c.name === 't2_session')).toBe(false);

    const now = Math.floor(Date.now() / 1000);
    const good = await generate({ secret: enrollment.secret, epoch: now + 30 });
    const ok = await app.inject({ method: 'POST', url: '/auth/login/mfa', payload: { mfa_token, method: 'totp', code: good } });
    expect(ok.statusCode).toBe(200);
  });

  it('an expired/unknown mfa_token is rejected (400), not treated as "no MFA required"', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login/mfa',
      payload: { mfa_token: 'not-a-real-token', method: 'totp', code: '123456' }
    });
    expect(res.statusCode).toBe(400);
    expect(res.cookies.some((c: any) => c.name === 't2_session')).toBe(false);
  });

  it('a consumed mfa_token cannot be replayed for a second session', async () => {
    const app = await getApp();
    const org = await fx.createOrg('MFA Replay Org');
    const passwordHash = await hashPassword('plain-pass-replay');
    const phone = uniquePhone();
    const { id } = await fx.createPhoneEmployee(org, phone, passwordHash, { fullName: 'Replay' });
    const enrollment = await totp.startTotpEnrollment(id, phone);
    await totp.confirmTotpEnrollment(id, await generate({ secret: enrollment.secret }));

    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { phone, password: 'plain-pass-replay' } });
    const { mfa_token } = login.json();
    const now = Math.floor(Date.now() / 1000);
    const code1 = await generate({ secret: enrollment.secret, epoch: now + 30 });
    const first = await app.inject({ method: 'POST', url: '/auth/login/mfa', payload: { mfa_token, method: 'totp', code: code1 } });
    expect(first.statusCode).toBe(200);

    const code2 = await generate({ secret: enrollment.secret, epoch: now + 90 });
    const second = await app.inject({ method: 'POST', url: '/auth/login/mfa', payload: { mfa_token, method: 'totp', code: code2 } });
    expect(second.statusCode).toBe(400); // токен уже consumed
  });

  it('login-mfa also accepts a recovery code, which is then single-use', async () => {
    const app = await getApp();
    const org = await fx.createOrg('MFA Recovery Login Org');
    const passwordHash = await hashPassword('plain-pass-rec');
    const phone = uniquePhone();
    const { id } = await fx.createPhoneEmployee(org, phone, passwordHash, { fullName: 'Recovery Login' });
    const enrollment = await totp.startTotpEnrollment(id, phone);
    await totp.confirmTotpEnrollment(id, await generate({ secret: enrollment.secret }));
    const [code] = await recoveryCodes.generateRecoveryCodes(id);

    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { phone, password: 'plain-pass-rec' } });
    const { mfa_token } = login.json();
    const res = await app.inject({ method: 'POST', url: '/auth/login/mfa', payload: { mfa_token, method: 'recovery_code', code } });
    expect(res.statusCode).toBe(200);
    expect(await recoveryCodes.countRemainingRecoveryCodes(id)).toBe(9);
  });

  it('/auth/mfa/step-up refuses to issue a ticket for an account with no confirmed factor', async () => {
    const app = await getApp();
    const org = await fx.createOrg('StepUp NoFactor Org');
    // §2/PRIV-MFA-1 (20.52.1) — an admin/supervisor with no confirmed
    // factor is now blocked by the broader requireActive() gate
    // (auth/guards.ts) before this route's own, more specific
    // mfa_not_configured check ever runs — the two checks answer the
    // same underlying question ("does this account have MFA?"), the
    // broader one just fires first for privileged roles now. Confirmed
    // separately (non-privileged role) below.
    const admin = await fx.createEmployee(org, { role: 'admin', mfa: false });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/mfa/step-up',
      headers: authAs(admin.telegramId),
      payload: { method: 'totp', code: '123456' }
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('mfa_enrollment_required');
  });

  it('/auth/mfa/step-up still answers mfa_not_configured for a non-privileged role with no factor (broader gate does not apply)', async () => {
    const app = await getApp();
    const org = await fx.createOrg('StepUp NoFactor NonPriv Org');
    const employee = await fx.createEmployee(org, { role: 'employee' });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/mfa/step-up',
      headers: authAs(employee.telegramId),
      payload: { method: 'totp', code: '123456' }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('mfa_not_configured');
  });

  it('step-up ticket works across the Telegram channel too (channel-agnostic by design)', async () => {
    const app = await getApp();
    const org = await fx.createOrg('StepUp Telegram Org');
    const admin = await fx.createEmployee(org, { role: 'admin' });
    const headers = await setupTotpAndStepUp(admin.id, authAs(admin.telegramId));
    expect(headers['x-step-up-token']).toBeTruthy();

    // Тикет реально даёт пройти step-up-gated действие — назначение
    // роли admin другому сотруднику.
    const target = await fx.createEmployee(org, { role: 'employee' });
    const grant = await app.inject({
      method: 'PATCH',
      url: `/employees/${target.id}/role`,
      headers: { ...authAs(admin.telegramId), ...headers },
      payload: { role: 'admin' }
    });
    expect(grant.statusCode).toBe(200);
  });

  it('granting the admin role WITHOUT a step-up ticket is rejected', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Grant NoStepUp Org');
    const admin = await fx.createEmployee(org, { role: 'admin' });
    const target = await fx.createEmployee(org, { role: 'employee' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/employees/${target.id}/role`,
      headers: authAs(admin.telegramId, admin.telegramGrantToken),
      payload: { role: 'admin' }
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('step_up_required');
  });

  it('granting a non-admin role does NOT require step-up (only admin-grant is gated)', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Grant Manager NoStepUp Org');
    const admin = await fx.createEmployee(org, { role: 'admin' });
    const target = await fx.createEmployee(org, { role: 'employee' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/employees/${target.id}/role`,
      headers: authAs(admin.telegramId, admin.telegramGrantToken),
      payload: { role: 'manager' }
    });
    expect(res.statusCode).toBe(200);
  });

  it('a step-up ticket belonging to a different employee cannot be used', async () => {
    const app = await getApp();
    const org = await fx.createOrg('StepUp CrossEmp Org');
    const adminA = await fx.createEmployee(org, { role: 'admin' });
    const adminB = await fx.createEmployee(org, { role: 'admin' });
    const headersA = await setupTotpAndStepUp(adminA.id, authAs(adminA.telegramId));
    const target = await fx.createEmployee(org, { role: 'employee' });

    // adminB пытается воспользоваться step-up-тикетом adminA.
    const res = await app.inject({
      method: 'PATCH',
      url: `/employees/${target.id}/role`,
      headers: { ...authAs(adminB.telegramId, adminB.telegramGrantToken), 'x-step-up-token': headersA['x-step-up-token'] },
      payload: { role: 'admin' }
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('step_up_required');
  });

  it('an expired step-up ticket is rejected', async () => {
    const org = await fx.createOrg('StepUp Expired Org');
    const admin = await fx.createEmployee(org, { role: 'admin' });
    const enrollment = await totp.startTotpEnrollment(admin.id, 'expiry-test');
    await totp.confirmTotpEnrollment(admin.id, await generate({ secret: enrollment.secret }));
    // TTL=-1 минута — тикет уже "истёк" в момент выдачи.
    const expiredToken = await mfaRepo.createStepUpTicket(admin.id, -1);

    const app = await getApp();
    const target = await fx.createEmployee(org, { role: 'employee' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/employees/${target.id}/role`,
      headers: { ...authAs(admin.telegramId), 'x-step-up-token': expiredToken },
      payload: { role: 'admin' }
    });
    expect(res.statusCode).toBe(403);
  });

  // ===== Last-factor removal guard (MFA-3) =====

  it('disabling TOTP is blocked for admin/supervisor if it is the last factor', async () => {
    const app = await getApp();
    const org = await fx.createOrg('LastFactor TOTP Org');
    const admin = await fx.createEmployee(org, { role: 'admin' });
    const headers = await setupTotpAndStepUp(admin.id, authAs(admin.telegramId));

    const res = await app.inject({
      method: 'DELETE',
      url: '/auth/mfa/totp',
      headers: { ...authAs(admin.telegramId), ...headers }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('last_mfa_factor');
    expect(await totp.isTotpConfirmed(admin.id)).toBe(true); // всё ещё включён
  });

  it('disabling TOTP is allowed for a non-mandatory role (employee) even as the only factor', async () => {
    const app = await getApp();
    const org = await fx.createOrg('LastFactor Employee Org');
    const { id, telegramId } = await fx.createEmployee(org, { role: 'employee' });
    const enrollment = await totp.startTotpEnrollment(id, 'emp');
    await totp.confirmTotpEnrollment(id, await generate({ secret: enrollment.secret }));
    const headers = await setupTotpAndStepUp(id, authAs(telegramId));

    const res = await app.inject({ method: 'DELETE', url: '/auth/mfa/totp', headers: { ...authAs(telegramId), ...headers } });
    expect(res.statusCode).toBe(200);
    expect(await totp.isTotpConfirmed(id)).toBe(false);
  });

  // ===== Admin resets another employee's MFA =====

  it('admin can reset another employee MFA with step-up; it revokes all their factors and sessions', async () => {
    const app = await getApp();
    const org = await fx.createOrg('AdminMfaReset Org');
    const admin = await fx.createEmployee(org, { role: 'admin' });
    const adminHeaders = await setupTotpAndStepUp(admin.id, authAs(admin.telegramId));

    const target = await fx.createEmployee(org, { role: 'employee' });
    const targetEnrollment = await totp.startTotpEnrollment(target.id, 'target');
    await totp.confirmTotpEnrollment(target.id, await generate({ secret: targetEnrollment.secret }));
    await recoveryCodes.generateRecoveryCodes(target.id);

    const res = await app.inject({
      method: 'POST',
      url: `/employees/${target.id}/mfa/reset`,
      headers: { ...authAs(admin.telegramId), ...adminHeaders }
    });
    expect(res.statusCode).toBe(200);
    expect(await totp.isTotpConfirmed(target.id)).toBe(false);
    expect(await recoveryCodes.countRemainingRecoveryCodes(target.id)).toBe(0);
  });

  it('admin MFA reset WITHOUT step-up is rejected', async () => {
    const app = await getApp();
    const org = await fx.createOrg('AdminMfaReset NoStepUp Org');
    const admin = await fx.createEmployee(org, { role: 'admin' });
    const target = await fx.createEmployee(org, { role: 'employee' });
    const res = await app.inject({
      method: 'POST',
      url: `/employees/${target.id}/mfa/reset`,
      headers: authAs(admin.telegramId)
    });
    expect(res.statusCode).toBe(403);
  });

  it('admin MFA reset is org-scoped — cannot reset an employee in a different org', async () => {
    const app = await getApp();
    const orgA = await fx.createOrg('AdminMfaReset OrgA');
    const orgB = await fx.createOrg('AdminMfaReset OrgB');
    const admin = await fx.createEmployee(orgA, { role: 'admin' });
    const adminHeaders = await setupTotpAndStepUp(admin.id, authAs(admin.telegramId));
    const target = await fx.createEmployee(orgB, { role: 'employee' });

    const res = await app.inject({
      method: 'POST',
      url: `/employees/${target.id}/mfa/reset`,
      headers: { ...authAs(admin.telegramId), ...adminHeaders }
    });
    expect(res.statusCode).toBe(403);
  });

  // ===== WebAuthn boundary checks (no real ceremony — see file docstring) =====

  it('POST /auth/mfa/webauthn/register/verify with a malformed response is rejected, never throws 500', async () => {
    const app = await getApp();
    const org = await fx.createOrg('WebAuthn Malformed Org');
    const { telegramId } = await fx.createEmployee(org, { role: 'employee' });
    await app.inject({ method: 'POST', url: '/auth/mfa/webauthn/register/options', headers: authAs(telegramId) });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/mfa/webauthn/register/verify',
      headers: authAs(telegramId),
      payload: { response: { garbage: true } }
    });
    expect(res.statusCode).toBe(400);
  });

  it('/auth/mfa/webauthn/credentials/:id revoke is ownership-scoped — cannot revoke another employee\'s credential', async () => {
    const app = await getApp();
    const org = await fx.createOrg('WebAuthn CrossEmp Org');
    const owner = await fx.createEmployee(org, { role: 'employee' });
    const stranger = await fx.createEmployee(org, { role: 'employee' });
    await mfaRepo.createWebAuthnCredential({
      employeeId: owner.id,
      credentialId: `cred-${owner.id}-${Date.now()}`,
      publicKeyBase64: Buffer.from('fake-public-key').toString('base64'),
      counter: 0,
      deviceType: 'singleDevice',
      backedUp: false,
      deviceName: 'Test Key'
    });
    const creds = await mfaRepo.listActiveWebAuthnCredentials(owner.id);
    expect(creds.length).toBe(1);

    // stranger сам должен пройти step-up (это employee-роль — TOTP не
    // обязателен политикой, но эндпоинт всё равно требует step-up для
    // ЛЮБОГО удаления credential'а) — иначе тест проверял бы только
    // step_up_required, а не собственно ownership-scope ниже.
    const strangerStepUp = await setupTotpAndStepUp(stranger.id, authAs(stranger.telegramId));
    const res = await app.inject({
      method: 'DELETE',
      url: `/auth/mfa/webauthn/credentials/${creds[0].id}`,
      headers: { ...authAs(stranger.telegramId), ...strangerStepUp }
    });
    expect(res.statusCode).toBe(404); // не найдено в scope этого employee_id
    const stillActive = await mfaRepo.listActiveWebAuthnCredentials(owner.id);
    expect(stillActive.length).toBe(1);
  });

  // ===== Status endpoint =====

  it('/auth/mfa/status reflects enrollment_required for admin without any factor', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Status Org');
    const admin = await fx.createEmployee(org, { role: 'admin', mfa: false });
    const res = await app.inject({ method: 'GET', url: '/auth/mfa/status', headers: authAs(admin.telegramId) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enabled).toBe(false);
    expect(body.enrollment_required).toBe(true);
  });

  it('/auth/mfa/status shows enrollment_required=false once a factor is confirmed', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Status Confirmed Org');
    const admin = await fx.createEmployee(org, { role: 'admin' });
    const enrollment = await totp.startTotpEnrollment(admin.id, 'x');
    await totp.confirmTotpEnrollment(admin.id, await generate({ secret: enrollment.secret }));
    const res = await app.inject({ method: 'GET', url: '/auth/mfa/status', headers: authAs(admin.telegramId) });
    const body = res.json();
    expect(body.enabled).toBe(true);
    expect(body.enrollment_required).toBe(false);
  });
});
