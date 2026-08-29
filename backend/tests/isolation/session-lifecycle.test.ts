/**
 * 20.48.0 (Web Security & Trust Layer, Auth & Session Security) —
 * инварианты B1 плана: деактивация и смена/сброс пароля обязаны
 * инвалидировать все активные browser-сессии сотрудника немедленно.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAs, authAsSession, setupTotpAndStepUp } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import { hashPassword } from '../../src/auth/password.js';
import * as sessionsRepo from '../../src/data/repositories/sessions.js';

function uniquePhone(): string {
  return '+7903' + Math.floor(1000000 + Math.random() * 8999999);
}

describe('Session lifecycle — отзыв при деактивации и смене пароля', () => {
  const fx = new TestFixtures();
  afterAll(() => fx.cleanup());

  it('деактивация (DELETE /employees/:id) отзывает все browser-сессии и telegram-identity, phone НЕ трогает', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Deactivate Session Org');
    const manager = await fx.createEmployee(org, { role: 'manager' });
    const target = await fx.createEmployee(org, { role: 'employee' });
    const phone = uniquePhone();
    const passwordHash = await hashPassword('deact-pass');
    await query(`UPDATE employees SET phone=$1, password_hash=$2 WHERE id=$3`, [phone, passwordHash, target.id]);
    await query(`INSERT INTO identities (employee_id, provider, provider_key) VALUES ($1,'phone',$2)`, [target.id, phone]);
    const token = await sessionsRepo.createSession(target.id);

    const before = await app.inject({ method: 'GET', url: '/me', headers: authAsSession(token) });
    expect(before.statusCode).toBe(200);

    const del = await app.inject({ method: 'DELETE', url: `/employees/${target.id}`, headers: authAs(manager.telegramId) });
    expect(del.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: '/access/requests', headers: authAsSession(token) });
    expect(after.statusCode).toBe(401);

    const sessionRows = await query(`SELECT id FROM employee_sessions WHERE employee_id=$1`, [target.id]);
    expect(sessionRows.rows.length).toBe(0);

    const telegramIdentity = await query(`SELECT id FROM identities WHERE employee_id=$1 AND provider='telegram'`, [target.id]);
    expect(telegramIdentity.rows.length).toBe(0);

    // phone identity/колонка пережила деактивацию — как и раньше employees.phone.
    const phoneIdentity = await query(`SELECT id FROM identities WHERE employee_id=$1 AND provider='phone'`, [target.id]);
    expect(phoneIdentity.rows.length).toBe(1);
    const row = await query(`SELECT phone FROM employees WHERE id=$1`, [target.id]);
    expect(row.rows[0].phone).toBe(phone);
  });

  it('password reset инвалидирует ВСЕ существующие сессии сотрудника (устройство A украдено → пароль меняют на B → A отваливается)', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Reset Invalidate Org');
    const admin = await fx.createEmployee(org, { role: 'admin' });
    const passwordHash = await hashPassword('old-pass');
    const { id: employeeId } = await fx.createPhoneEmployee(org, uniquePhone(), passwordHash, { fullName: 'Reset Invalidate Target' });

    // "устройство A" — сессия, созданная до сброса пароля.
    const tokenA = await sessionsRepo.createSession(employeeId);
    const beforeReset = await app.inject({ method: 'GET', url: '/access/requests', headers: authAsSession(tokenA) });
    expect(beforeReset.statusCode).toBe(403); // employee, не manager — но авторизован (не 401)

    // 20.52.0 (MFA) — сброс чужого пароля теперь step-up-gated.
    const stepUpHeaders = await setupTotpAndStepUp(admin.id, authAs(admin.telegramId));
    const genLink = await app.inject({
      method: 'POST',
      url: `/auth/admin/reset-password/${employeeId}`,
      headers: { ...authAs(admin.telegramId), ...stepUpHeaders }
    });
    const resetUrl: string = genLink.json().reset_url;
    const token = resetUrl.split('reset=')[1];
    const consume = await app.inject({ method: 'POST', url: `/auth/reset/${token}`, payload: { password: 'new-pass' } });
    expect(consume.statusCode).toBe(200);

    // "устройство A" больше не работает.
    const afterReset = await app.inject({ method: 'GET', url: '/access/requests', headers: authAsSession(tokenA) });
    expect(afterReset.statusCode).toBe(401);
  });

  it('session fixation: cookie, выставленный ДО login, не становится валидной сессией после успешного входа', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Fixation Org');
    const passwordHash = await hashPassword('fixation-pass');
    const { phone } = await fx.createPhoneEmployee(org, uniquePhone(), passwordHash, { fullName: 'Fixation Target' });

    const preLoginToken = 'attacker-guessed-token-does-not-exist';
    const preCheck = await app.inject({ method: 'GET', url: '/access/requests', headers: authAsSession(preLoginToken) });
    expect(preCheck.statusCode).toBe(401);

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { cookie: `t2_session=${preLoginToken}` },
      payload: { phone, password: 'fixation-pass' }
    });
    expect(login.statusCode).toBe(200);
    const setCookies = login.cookies.filter((c: any) => c.name === 't2_session');
    expect(setCookies.length).toBe(1);
    // createSession() всегда генерирует новый randomBytes(32) токен — не
    // переиспользует то, что пришло в запросе с cookie.
    expect(setCookies[0].value).not.toBe(preLoginToken);

    const afterLogin = await app.inject({ method: 'GET', url: '/access/requests', headers: authAsSession(preLoginToken) });
    expect(afterLogin.statusCode).toBe(401);
  });

  it('idle timeout (20.52.0): a session untouched for >14 days no longer resolves, even with a valid absolute TTL remaining', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Idle Timeout Org');
    const passwordHash = await hashPassword('idle-pass');
    const { id } = await fx.createPhoneEmployee(org, uniquePhone(), passwordHash, { fullName: 'Idle Target' });
    const token = await sessionsRepo.createSession(id);

    const fresh = await app.inject({ method: 'GET', url: '/access/requests', headers: authAsSession(token) });
    expect(fresh.statusCode).toBe(403); // авторизован (employee, не 401), просто не manager

    await query(`UPDATE employee_sessions SET last_seen_at = now() - interval '15 days' WHERE token_hash = $1`, [sessionsRepo.hashToken(token)]);
    const stale = await app.inject({ method: 'GET', url: '/access/requests', headers: authAsSession(token) });
    expect(stale.statusCode).toBe(401);
  });

  it('privileged roles (admin/supervisor) get a shorter absolute session TTL than regular roles (§9)', async () => {
    const org = await fx.createOrg('Privileged TTL Org');
    const passwordHash = await hashPassword('priv-pass');
    const { id: adminId } = await fx.createPhoneEmployee(org, uniquePhone(), passwordHash, { fullName: 'Priv Admin', role: 'admin' });
    const { id: empId } = await fx.createPhoneEmployee(org, uniquePhone(), passwordHash, { fullName: 'Priv Employee', role: 'employee' });

    await sessionsRepo.createSession(adminId, false, 'admin');
    await sessionsRepo.createSession(empId, false, 'employee');

    const rows = await query(
      `SELECT employee_id, expires_at - created_at AS ttl FROM employee_sessions WHERE employee_id = ANY($1)`,
      [[adminId, empId]]
    );
    const adminTtlDays = rows.rows.find((r: any) => Number(r.employee_id) === adminId).ttl.days;
    const empTtlDays = rows.rows.find((r: any) => Number(r.employee_id) === empId).ttl.days;
    expect(adminTtlDays).toBeLessThan(empTtlDays);
    expect(adminTtlDays).toBe(7);
    expect(empTtlDays).toBe(30);
  });
});
