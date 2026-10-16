/**
 * T2 Miranda, этап B (вариант B, план §Верификация) — изоляция точечных
 * корп-аккаунтов (телефон+пароль, без employee_id): логин
 * успех/неверный пароль/неизвестный телефон (timing-safe — обе ветки
 * одинаковый статус/код ошибки, не раскрывают существование аккаунта),
 * дубль телефона в той же сети → 409, точечная сессия пишет/читает
 * мессенджер но не проходит requireAdmin, revoke/logout мгновенно
 * блокирует старый токен, org-изоляция.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import * as sessionsRepo from '../../src/data/repositories/sessions.js';

describe('T2 Miranda — точечные аккаунты (телефон+пароль)', () => {
  const fx = new TestFixtures();
  const corporateAccountIds: number[] = [];
  const conversationIds: string[] = [];

  afterAll(async () => {
    if (conversationIds.length) {
      await query(`DELETE FROM messenger_messages WHERE conversation_id = ANY($1)`, [conversationIds]);
      await query(`DELETE FROM messenger_conversation_members WHERE conversation_id = ANY($1)`, [conversationIds]);
      await query(`DELETE FROM messenger_conversations WHERE id = ANY($1)`, [conversationIds]);
    }
    if (corporateAccountIds.length) {
      await query(`UPDATE employee_sessions SET active_corporate_account_id = NULL WHERE active_corporate_account_id = ANY($1)`, [corporateAccountIds]);
      await query(`DELETE FROM corporate_account_sessions WHERE corporate_account_id = ANY($1)`, [corporateAccountIds]);
      await query(`DELETE FROM corporate_accounts WHERE id = ANY($1)`, [corporateAccountIds]);
    }
    await fx.cleanup();
  });

  function pointCookieFrom(res: { cookies: Array<{ name: string; value: string }> }): string {
    const c = res.cookies.find((c) => c.name === 't2_point_session');
    if (!c) throw new Error('t2_point_session cookie not set');
    return c.value;
  }

  async function createPointAccount(
    orgId: string,
    phone: string,
    password: string,
    accountName: string,
    adminHeaders: Record<string, string>
  ): Promise<number> {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/miranda/accounts',
      headers: { ...adminHeaders, 'content-type': 'application/json' },
      payload: { phone, password, accountName }
    });
    expect(res.statusCode).toBe(201);
    const id = Number(res.json().item.id);
    corporateAccountIds.push(id);
    return id;
  }

  it('POST /miranda/accounts/login — неизвестный телефон и неверный пароль оба дают 401 invalid_credentials (не раскрывают существование аккаунта)', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Point Login Enumeration Org');
    const admin = await fx.createEmployee(org, { role: 'admin' });
    await createPointAccount(org, '+79992000001', 'correct-password-1', 'Касса Энумерация', authAs(admin.telegramId, admin.telegramGrantToken));

    const unknownPhone = await app.inject({
      method: 'POST',
      url: '/miranda/accounts/login',
      headers: { 'content-type': 'application/json' },
      payload: { phone: '+79992099999', password: 'whatever-password' }
    });
    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/miranda/accounts/login',
      headers: { 'content-type': 'application/json' },
      payload: { phone: '+79992000001', password: 'wrong-password' }
    });

    expect(unknownPhone.statusCode).toBe(401);
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownPhone.json().error).toBe('invalid_credentials');
    expect(wrongPassword.json().error).toBe('invalid_credentials');
  });

  it('POST /miranda/accounts/login — верные телефон+пароль входят, ставят t2_point_session, аудит пишется', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Point Login Success Org');
    const admin = await fx.createEmployee(org, { role: 'admin' });
    const accountId = await createPointAccount(org, '+79992000002', 'correct-password-2', 'Касса Вход', authAs(admin.telegramId, admin.telegramGrantToken));

    const login = await app.inject({
      method: 'POST',
      url: '/miranda/accounts/login',
      headers: { 'content-type': 'application/json' },
      payload: { phone: '+79992000002', password: 'correct-password-2' }
    });
    expect(login.statusCode).toBe(200);
    const token = pointCookieFrom(login);
    expect(token).toBeTruthy();

    const auditActions = await query(
      `SELECT action FROM audit_log WHERE target_type = 'corporate_account' AND target_id = $1 ORDER BY id ASC`,
      [String(accountId)]
    );
    expect(auditActions.rows.map((r: any) => r.action)).toEqual(expect.arrayContaining(['miranda.point_login_success']));
  });

  it('POST /miranda/accounts — дубль телефона в той же сети → 409 phone_conflict', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Point Phone Conflict Org');
    const admin = await fx.createEmployee(org, { role: 'admin' });
    const adminHeaders = authAs(admin.telegramId, admin.telegramGrantToken);
    await createPointAccount(org, '+79992000003', 'password-dup', 'Касса Первая', adminHeaders);

    const dup = await app.inject({
      method: 'POST',
      url: '/miranda/accounts',
      headers: { ...adminHeaders, 'content-type': 'application/json' },
      payload: { phone: '+79992000003', password: 'different-password', accountName: 'Касса Вторая' }
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toBe('phone_conflict');
  });

  it('точечная сессия пишет/читает сообщения в диалоге, но не проходит requireAdmin-маршруты', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Point Messenger Org');
    const admin = await fx.createEmployee(org, { role: 'admin' });
    const adminHeaders = authAs(admin.telegramId, admin.telegramGrantToken);
    await createPointAccount(org, '+79992000004', 'password-point', 'Касса Мессенджер', adminHeaders);

    const otherEmp = await fx.createPhoneEmployee(org, '+79992000005', null, { role: 'employee', fullName: 'Обычный сотрудник' });
    const otherToken = await sessionsRepo.createSession(otherEmp.id, false, 'employee');
    const otherAcctRes = await query(
      `INSERT INTO corporate_accounts (org_id, employee_id, display_label) VALUES ($1, $2, $3) RETURNING id`,
      [org, otherEmp.id, 'Обычный сотрудник']
    );
    const otherAccountId = Number(otherAcctRes.rows[0].id);
    corporateAccountIds.push(otherAccountId);
    await query(
      `UPDATE employee_sessions SET active_corporate_account_id = $1 WHERE token_hash = encode(sha256($2::bytea), 'hex')`,
      [otherAccountId, otherToken]
    );

    const login = await app.inject({
      method: 'POST',
      url: '/miranda/accounts/login',
      headers: { 'content-type': 'application/json' },
      payload: { phone: '+79992000004', password: 'password-point' }
    });
    const pointToken = pointCookieFrom(login);
    const pointCookieHeader = { cookie: `t2_point_session=${pointToken}` };

    const direct = await app.inject({
      method: 'POST',
      url: '/miranda/conversations/direct',
      headers: { ...pointCookieHeader, 'content-type': 'application/json' },
      payload: { targetCorporateAccountId: otherAccountId }
    });
    expect(direct.statusCode).toBe(200);
    const conversationId = direct.json().conversationId;
    conversationIds.push(conversationId);

    const post = await app.inject({
      method: 'POST',
      url: `/miranda/conversations/${conversationId}/messages`,
      headers: { ...pointCookieHeader, 'content-type': 'application/json' },
      payload: { clientMessageId: '11111111-1111-1111-1111-111111111111', body: 'Привет от точки' }
    });
    expect(post.statusCode).toBe(200);
    expect(post.json().sender.employeeId).toBeNull();

    const list = await app.inject({
      method: 'GET',
      url: `/miranda/conversations/${conversationId}/messages`,
      headers: pointCookieHeader
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items.length).toBeGreaterThan(0);

    // requireAdmin-маршруты недоступны точечной сессии вообще (нет
    // request.user — не employee-сессия) — ожидаем 401, не 403.
    const adminRoute = await app.inject({ method: 'GET', url: '/miranda/accounts', headers: pointCookieHeader });
    expect(adminRoute.statusCode).toBe(401);
  });

  it('logout точки мгновенно блокирует дальнейшие запросы по старому токену', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Point Logout Org');
    const admin = await fx.createEmployee(org, { role: 'admin' });
    await createPointAccount(org, '+79992000006', 'password-logout', 'Касса Логаут', authAs(admin.telegramId, admin.telegramGrantToken));

    const login = await app.inject({
      method: 'POST',
      url: '/miranda/accounts/login',
      headers: { 'content-type': 'application/json' },
      payload: { phone: '+79992000006', password: 'password-logout' }
    });
    const pointToken = pointCookieFrom(login);
    const pointCookieHeader = { cookie: `t2_point_session=${pointToken}` };

    const before = await app.inject({ method: 'GET', url: '/miranda/conversations', headers: pointCookieHeader });
    expect(before.statusCode).toBe(200);

    const logout = await app.inject({ method: 'POST', url: '/miranda/accounts/logout', headers: pointCookieHeader });
    expect(logout.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: '/miranda/conversations', headers: pointCookieHeader });
    expect(after.statusCode).toBe(401);
    expect(after.json().error).toBe('invalid_point_session');
  });

  it('org-изоляция: точка одной сети не видит/не начинает диалог с аккаунтом другой сети', async () => {
    const app = await getApp();
    const orgA = await fx.createOrg('Point Org Isolation A');
    const orgB = await fx.createOrg('Point Org Isolation B');
    const adminA = await fx.createEmployee(orgA, { role: 'admin' });
    const adminB = await fx.createEmployee(orgB, { role: 'admin' });
    await createPointAccount(orgA, '+79992000007', 'password-org-a', 'Касса Сеть А', authAs(adminA.telegramId, adminA.telegramGrantToken));
    const targetAccountIdB = await createPointAccount(orgB, '+79992000008', 'password-org-b', 'Касса Сеть Б', authAs(adminB.telegramId, adminB.telegramGrantToken));

    const login = await app.inject({
      method: 'POST',
      url: '/miranda/accounts/login',
      headers: { 'content-type': 'application/json' },
      payload: { phone: '+79992000007', password: 'password-org-a' }
    });
    const pointToken = pointCookieFrom(login);
    const pointCookieHeader = { cookie: `t2_point_session=${pointToken}` };

    const crossOrgDirect = await app.inject({
      method: 'POST',
      url: '/miranda/conversations/direct',
      headers: { ...pointCookieHeader, 'content-type': 'application/json' },
      payload: { targetCorporateAccountId: targetAccountIdB }
    });
    expect(crossOrgDirect.statusCode).toBe(400);
    expect(crossOrgDirect.json().error).toBe('not_active');
  });
});
