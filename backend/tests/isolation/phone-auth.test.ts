/**
 * Не-Telegram вход (телефон + пароль, 20.35, план) — второй identity
 * provider поверх шва 20.9.0 (ADR-005). Telegram-путь не тронут — часть
 * тестов явно проверяет, что оба провайдера работают ПАРАЛЛЕЛЬНО на одном
 * инстансе, не только что новый не ломает старый.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAs, authAsSession, setupTotpAndStepUp } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import { hashPassword, verifyPassword } from '../../src/auth/password.js';
import { normalizePhone } from '../../src/utils/phone.js';
import * as sessionsRepo from '../../src/data/repositories/sessions.js';

// 20.48.0 — уже в каноническом формате normalizePhone() (+7XXXXXXXXXX),
// чтобы raw-значение теста совпадало побайтово с тем, что реально
// сохраняется/резолвится через identities (см. utils/phone.ts).
function uniquePhone(): string {
  return '+7900' + Math.floor(1000000 + Math.random() * 8999999);
}

describe('Не-Telegram вход — телефон + пароль', () => {
  const fx = new TestFixtures();
  const extraEmployeeIds: number[] = [];
  const usedPhones: string[] = [];

  function trackPhone(phone: string): string {
    usedPhones.push(phone);
    return phone;
  }

  afterAll(async () => {
    // access_requests(org_id) — FK на organizations (0016) — должны уйти
    // раньше fx.cleanup(), иначе удаление тестовых org падает FK-нарушением.
    if (usedPhones.length) {
      await query(`DELETE FROM access_requests WHERE phone = ANY($1)`, [usedPhones]);
    }
    if (extraEmployeeIds.length) {
      await query(`DELETE FROM employee_sessions WHERE employee_id = ANY($1)`, [extraEmployeeIds]);
      await query(`DELETE FROM employee_password_resets WHERE employee_id = ANY($1)`, [extraEmployeeIds]);
      await query(`DELETE FROM employees WHERE id = ANY($1)`, [extraEmployeeIds]);
    }
    await fx.cleanup();
  });

  it('hashPassword/verifyPassword — round-trip, неверный пароль не проходит', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('wrong password', hash)).toBe(false);
  });

  it('POST /auth/register → создаёт pending access_requests с provider=phone, дубль номера — 409/дедуп заявки', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Phone Auth Org');
    const phone = trackPhone(uniquePhone());

    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { phone, password: 'password123', full_name: 'Новый Сотрудник', org_id: org }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('pending');
    // password_hash не должен уйти в HTTP-ответ, даже хешированный.
    expect(res.json().request.password_hash).toBeUndefined();
    expect(JSON.stringify(res.json())).not.toContain('password123');

    const row = await query(`SELECT provider, phone, password_hash, status FROM access_requests WHERE phone = $1`, [phone]);
    expect(row.rows[0].provider).toBe('phone');
    expect(row.rows[0].status).toBe('pending');
    expect(row.rows[0].password_hash).not.toBeNull();
    expect(row.rows[0].password_hash).not.toContain('password123'); // не plaintext

    // Повторная заявка тем же номером, пока первая ещё pending — дедуп, не вторая строка.
    const again = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { phone, password: 'password123', full_name: 'Новый Сотрудник', org_id: org }
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().status).toBe('pending');
    const count = await query(`SELECT count(*)::int as c FROM access_requests WHERE phone = $1`, [phone]);
    expect(count.rows[0].c).toBe(1);
  });

  it('POST /auth/register — некорректный телефон отклоняется', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { phone: 'not-a-phone', password: 'password123', full_name: 'X' }
    });
    expect(res.statusCode).toBe(400);
  });

  it('Approve заявки provider=phone (create-новый) — сотрудник получает phone+password_hash, может логиниться', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Phone Approve Org');
    const admin = await fx.createEmployee(org, { role: 'admin' });
    const phone = trackPhone(uniquePhone());

    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { phone, password: 'secret-pass-1', full_name: 'Одобряемый Сотрудник', org_id: org }
    });
    const requestId = reg.json().request.id;

    const approve = await app.inject({
      method: 'POST',
      url: `/access/requests/${requestId}/approve`,
      headers: authAs(admin.telegramId, admin.telegramGrantToken),
      payload: {}
    });
    expect(approve.statusCode).toBe(200);
    const employeeId = Number(approve.json().employee_id);
    expect(employeeId).toBeGreaterThan(0);
    extraEmployeeIds.push(employeeId);

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { phone, password: 'secret-pass-1' }
    });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toEqual({ ok: true });
    expect(login.cookies.some((c: any) => c.name === 't2_session')).toBe(true);
  });

  it('Approve заявки provider=phone (claim существующей карточки) — привязывает phone к уже созданному employee', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Phone Claim Org');
    const admin = await fx.createEmployee(org, { role: 'admin' });
    const card = await fx.createEmployee(org, { telegramId: null }); // unclaimed-карточка
    const phone = trackPhone(uniquePhone());

    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { phone, password: 'secret-pass-2', full_name: 'Клейм', claimed_employee_id: card.id, org_id: org }
    });
    const requestId = reg.json().request.id;

    const approve = await app.inject({
      method: 'POST',
      url: `/access/requests/${requestId}/approve`,
      headers: authAs(admin.telegramId, admin.telegramGrantToken),
      payload: {}
    });
    expect(approve.statusCode).toBe(200);
    expect(Number(approve.json().employee_id)).toBe(card.id);

    const row = await query(`SELECT phone, access_status FROM employees WHERE id = $1`, [card.id]);
    expect(row.rows[0].phone).toBe(phone);
    expect(row.rows[0].access_status).toBe('active');
  });

  it('POST /auth/login — неверный пароль и несуществующий телефон дают одинаковый 401', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Phone Login Fail Org');
    const passwordHash = await hashPassword('right-password');
    const { phone } = await fx.createPhoneEmployee(org, uniquePhone(), passwordHash, { fullName: 'Login Test' });

    const wrongPassword = await app.inject({ method: 'POST', url: '/auth/login', payload: { phone, password: 'wrong' } });
    expect(wrongPassword.statusCode).toBe(401);

    const unknownPhone = await app.inject({ method: 'POST', url: '/auth/login', payload: { phone: uniquePhone(), password: 'right-password' } });
    expect(unknownPhone.statusCode).toBe(401);
    expect(unknownPhone.json().error).toBe(wrongPassword.json().error); // не различить по ответу
  });

  it('POST /auth/login — не-active сотрудник получает 403, не 401', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Phone Pending Org');
    const passwordHash = await hashPassword('some-password');
    const { phone } = await fx.createPhoneEmployee(org, uniquePhone(), passwordHash, { fullName: 'Pending Employee', accessStatus: 'pending' });

    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { phone, password: 'some-password' } });
    expect(login.statusCode).toBe(403);
  });

  it('Сессия из cookie удовлетворяет тем же гвардам, что Telegram — оба провайдера работают параллельно на одном инстансе', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Phone Guards Org');
    const manager = await fx.createEmployee(org, { role: 'manager' }); // Telegram
    const passwordHash = await hashPassword('guard-test-pass');
    const { id: phoneManagerId } = await fx.createPhoneEmployee(org, uniquePhone(), passwordHash, { fullName: 'Phone Manager', role: 'manager' });
    const token = await sessionsRepo.createSession(phoneManagerId);

    // requireManager-гейтед роут (GET /access/requests) — phone-сессия проходит гвард без единой правки в guards.ts.
    const viaPhone = await app.inject({ method: 'GET', url: '/access/requests', headers: authAsSession(token) });
    expect(viaPhone.statusCode).toBe(200);

    // Тот же роут, тот же гвард, Telegram-путь — параллельно, не заменён.
    const viaTelegram = await app.inject({ method: 'GET', url: '/access/requests', headers: authAs(manager.telegramId) });
    expect(viaTelegram.statusCode).toBe(200);

    // Гость без cookie/заголовков — request.user остаётся null (не подхватывает
    // чужую сессию), requireActive() отвечает 401 "не зарегистрирован", не 403.
    const anon = await app.inject({ method: 'GET', url: '/access/requests' });
    expect(anon.statusCode).toBe(401);
  });

  it('POST /auth/logout — удаляет сессию, повторный запрос с тем же токеном больше не авторизован', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Phone Logout Org');
    const passwordHash = await hashPassword('logout-pass');
    const { id: employeeId } = await fx.createPhoneEmployee(org, uniquePhone(), passwordHash, { fullName: 'Logout Test', role: 'manager' });
    const token = await sessionsRepo.createSession(employeeId);

    const before = await app.inject({ method: 'GET', url: '/access/requests', headers: authAsSession(token) });
    expect(before.statusCode).toBe(200);

    const logout = await app.inject({ method: 'POST', url: '/auth/logout', headers: authAsSession(token), payload: {} });
    expect(logout.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: '/access/requests', headers: authAsSession(token) });
    expect(after.statusCode).toBe(401); // сессия удалена → request.user === null → requireActive() 401
  });

  it('Admin-сброс пароля → одноразовая ссылка → /auth/reset/:token ставит новый пароль и логинит; повторное использование — 400', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Phone Reset Org');
    const admin = await fx.createEmployee(org, { role: 'admin' });
    const passwordHash = await hashPassword('old-password');
    const { id: employeeId, phone } = await fx.createPhoneEmployee(org, uniquePhone(), passwordHash, { fullName: 'Reset Test' });

    // 20.52.0 (MFA) — сброс чужого пароля теперь step-up-gated.
    const stepUpHeaders = await setupTotpAndStepUp(admin.id, authAs(admin.telegramId, admin.telegramGrantToken));
    const genLink = await app.inject({
      method: 'POST',
      url: `/auth/admin/reset-password/${employeeId}`,
      headers: { ...authAs(admin.telegramId, admin.telegramGrantToken), ...stepUpHeaders }
    });
    expect(genLink.statusCode).toBe(200);
    const resetUrl: string = genLink.json().reset_url;
    const token = resetUrl.split('reset=')[1];

    const consume = await app.inject({
      method: 'POST',
      url: `/auth/reset/${token}`,
      payload: { password: 'brand-new-password' }
    });
    expect(consume.statusCode).toBe(200);
    expect(consume.cookies.some((c: any) => c.name === 't2_session')).toBe(true);

    // Старый пароль больше не работает, новый — работает.
    const oldLogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { phone, password: 'old-password' } });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { phone, password: 'brand-new-password' } });
    expect(newLogin.statusCode).toBe(200);

    // Повторное использование того же токена — уже consumed.
    const reuse = await app.inject({ method: 'POST', url: `/auth/reset/${token}`, payload: { password: 'another-one' } });
    expect(reuse.statusCode).toBe(400);
  });

  it('employees.phone — UNIQUE на уровне БД, не только в приложении', async () => {
    const org = await fx.createOrg('Phone Unique Org');
    const phone = uniquePhone();
    const res = await query(
      `INSERT INTO employees (full_name, phone, role, access_status, is_active, org_id)
       VALUES ('First', $1, 'employee', 'active', true, $2) RETURNING id`,
      [phone, org]
    );
    extraEmployeeIds.push(res.rows[0].id);

    await expect(
      query(
        `INSERT INTO employees (full_name, phone, role, access_status, is_active, org_id)
         VALUES ('Second', $1, 'employee', 'active', true, $2)`,
        [phone, org]
      )
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});
