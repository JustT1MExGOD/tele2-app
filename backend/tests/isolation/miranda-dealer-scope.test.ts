/**
 * T2 Miranda — видимость контактов/групп/переписки в рамках всего дилера
 * (не одной сети), см. core/orgs/dealers.ts::resolveDealerOrgIds: два org
 * под одним дилером/сектором видят контакты друг друга в
 * /miranda/contacts(/all), могут добавлять контакт другой сети дилера в
 * общую группу и переписываться напрямую (дедуп диалога работает даже
 * когда диалог создан под org_id другой стороны); два org без общего
 * дилера остаются изолированы ровно как раньше (fallback dealerOrgIds =
 * [orgId] для сетей без сектора/дилера).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAsSession } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import * as sessionsRepo from '../../src/data/repositories/sessions.js';

describe('T2 Miranda — видимость в рамках дилера', () => {
  const fx = new TestFixtures();
  const corporateAccountIds: number[] = [];
  const groupIds: number[] = [];
  const conversationIds: string[] = [];

  afterAll(async () => {
    if (conversationIds.length) {
      await query(`DELETE FROM messenger_messages WHERE conversation_id = ANY($1)`, [conversationIds]);
      await query(`DELETE FROM messenger_conversation_members WHERE conversation_id = ANY($1)`, [conversationIds]);
      await query(`DELETE FROM messenger_conversations WHERE id = ANY($1)`, [conversationIds]);
    }
    if (groupIds.length) {
      await query(`DELETE FROM miranda_contact_group_members WHERE group_id = ANY($1)`, [groupIds]);
      await query(`DELETE FROM miranda_contact_groups WHERE id = ANY($1)`, [groupIds]);
    }
    if (corporateAccountIds.length) {
      await query(`DELETE FROM miranda_contact_group_members WHERE member_corporate_account_id = ANY($1)`, [corporateAccountIds]);
      await query(`UPDATE employee_sessions SET active_corporate_account_id = NULL WHERE active_corporate_account_id = ANY($1)`, [corporateAccountIds]);
      await query(`DELETE FROM corporate_accounts WHERE id = ANY($1)`, [corporateAccountIds]);
    }
    await query(`DELETE FROM audit_log WHERE action LIKE 'MIRANDA_CONTACT_GROUP_%'`);
    await fx.cleanup();
  });

  async function makeAccount(orgId: string, phone: string, fullName: string): Promise<{ accountId: number; sessionToken: string; employeeId: number }> {
    const emp = await fx.createPhoneEmployee(orgId, phone, null, { role: 'employee', fullName });
    const sessionToken = await sessionsRepo.createSession(emp.id, false, 'employee');
    const acctRes = await query(
      `INSERT INTO corporate_accounts (org_id, employee_id, display_label) VALUES ($1, $2, $3) RETURNING id`,
      [orgId, emp.id, fullName]
    );
    const accountId = Number(acctRes.rows[0].id);
    corporateAccountIds.push(accountId);
    await query(
      `UPDATE employee_sessions SET active_corporate_account_id = $1 WHERE token_hash = encode(sha256($2::bytea), 'hex')`,
      [accountId, sessionToken]
    );
    return { accountId, sessionToken, employeeId: emp.id };
  }

  async function makeAdmin(orgId: string, phone: string, fullName: string): Promise<{ accountId: number; sessionToken: string; employeeId: number }> {
    const emp = await fx.createPhoneEmployee(orgId, phone, null, { role: 'admin', fullName });
    await fx.enrollTotpFor(emp.id);
    const sessionToken = await sessionsRepo.createSession(emp.id, true, 'admin');
    const acctRes = await query(
      `INSERT INTO corporate_accounts (org_id, employee_id, display_label) VALUES ($1, $2, $3) RETURNING id`,
      [orgId, emp.id, fullName]
    );
    const accountId = Number(acctRes.rows[0].id);
    corporateAccountIds.push(accountId);
    await query(
      `UPDATE employee_sessions SET active_corporate_account_id = $1 WHERE token_hash = encode(sha256($2::bytea), 'hex')`,
      [accountId, sessionToken]
    );
    return { accountId, sessionToken, employeeId: emp.id };
  }

  it('два org одного дилера: видят контакты друг друга, общая группа, переписка с дедупом', async () => {
    const app = await getApp();
    const dealer = await fx.createDealer();
    const sector = await fx.createSector(undefined, dealer);
    const orgA = await fx.createOrg('Dealer Org A', sector);
    const orgB = await fx.createOrg('Dealer Org B', sector);

    const adminA = await makeAdmin(orgA, '+79992000001', 'Админ A');
    const empA = await makeAccount(orgA, '+79992000002', 'Сотрудник A');
    const empB = await makeAccount(orgB, '+79992000003', 'Сотрудник B');

    const allContacts = await app.inject({ method: 'GET', url: '/miranda/contacts/all', headers: authAsSession(empA.sessionToken) });
    expect(allContacts.statusCode).toBe(200);
    expect(allContacts.json().items.some((i: any) => Number(i.corporate_account_id) === empB.accountId)).toBe(true);

    const search = await app.inject({
      method: 'GET',
      url: '/miranda/contacts?q=' + encodeURIComponent('Сотрудник B'),
      headers: authAsSession(empA.sessionToken)
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().items.some((i: any) => Number(i.corporate_account_id) === empB.accountId)).toBe(true);

    const createGroup = await app.inject({
      method: 'POST',
      url: '/miranda/groups',
      headers: { ...authAsSession(adminA.sessionToken), 'content-type': 'application/json' },
      payload: { name: 'Общая группа дилера' }
    });
    expect(createGroup.statusCode).toBe(201);
    const groupId = Number(createGroup.json().item.id);
    groupIds.push(groupId);

    const addMember = await app.inject({
      method: 'POST',
      url: `/miranda/groups/${groupId}/members`,
      headers: { ...authAsSession(adminA.sessionToken), 'content-type': 'application/json' },
      payload: { corporateAccountId: empB.accountId }
    });
    expect(addMember.statusCode).toBe(200);

    const listGroups = await app.inject({ method: 'GET', url: '/miranda/groups', headers: authAsSession(empB.sessionToken) });
    expect(listGroups.statusCode).toBe(200);
    const group = listGroups.json().items.find((g: any) => Number(g.id) === groupId);
    expect(group.member_corporate_account_ids.map(Number)).toContain(empB.accountId);

    const direct = await app.inject({
      method: 'POST',
      url: '/miranda/conversations/direct',
      headers: { ...authAsSession(empA.sessionToken), 'content-type': 'application/json' },
      payload: { targetCorporateAccountId: empB.accountId }
    });
    expect(direct.statusCode).toBe(200);
    const conversationId = direct.json().conversationId;
    conversationIds.push(conversationId);

    const post = await app.inject({
      method: 'POST',
      url: `/miranda/conversations/${conversationId}/messages`,
      headers: { ...authAsSession(empA.sessionToken), 'content-type': 'application/json' },
      payload: { clientMessageId: crypto.randomUUID(), body: 'Привет из другой сети' }
    });
    expect(post.statusCode).toBe(200);

    const listMsgs = await app.inject({
      method: 'GET',
      url: `/miranda/conversations/${conversationId}/messages`,
      headers: authAsSession(empB.sessionToken)
    });
    expect(listMsgs.statusCode).toBe(200);
    expect(listMsgs.json().items.length).toBeGreaterThan(0);

    // Дедуп: B инициирует "новый" direct с A — должен вернуть ТОТ ЖЕ
    // диалог, хотя его org_id = orgA (diалог создала A), а не orgB.
    const second = await app.inject({
      method: 'POST',
      url: '/miranda/conversations/direct',
      headers: { ...authAsSession(empB.sessionToken), 'content-type': 'application/json' },
      payload: { targetCorporateAccountId: empA.accountId }
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().conversationId).toBe(conversationId);
  });

  it('два org без общего дилера — чтение контактов/диалог для СОТРУДНИКА остаётся изолированным (админ-мутации — глобальные, см. §A)', async () => {
    const app = await getApp();
    const orgA = await fx.createOrg('No Dealer Org A');
    const orgB = await fx.createOrg('No Dealer Org B');

    const adminA = await makeAdmin(orgA, '+79992000004', 'Админ без дилера');
    const empA = await makeAccount(orgA, '+79992000005', 'Сотрудник без дилера A');
    const empB = await makeAccount(orgB, '+79992000006', 'Сотрудник без дилера B');

    const allContacts = await app.inject({ method: 'GET', url: '/miranda/contacts/all', headers: authAsSession(empA.sessionToken) });
    expect(allContacts.statusCode).toBe(200);
    expect(allContacts.json().items.some((i: any) => Number(i.corporate_account_id) === empB.accountId)).toBe(false);

    const createGroup = await app.inject({
      method: 'POST',
      url: '/miranda/groups',
      headers: { ...authAsSession(adminA.sessionToken), 'content-type': 'application/json' },
      payload: { name: 'Своя группа без дилера' }
    });
    expect(createGroup.statusCode).toBe(201);
    const groupId = Number(createGroup.json().item.id);
    groupIds.push(groupId);

    // §A — админ глобальный, добавление участника из чужого (без общего
    // дилера) org больше не блокируется на уровне группы: мутации
    // контактных групп admin-only и работают с любой сетью.
    const addMember = await app.inject({
      method: 'POST',
      url: `/miranda/groups/${groupId}/members`,
      headers: { ...authAsSession(adminA.sessionToken), 'content-type': 'application/json' },
      payload: { corporateAccountId: empB.accountId }
    });
    expect(addMember.statusCode).toBe(200);

    const direct = await app.inject({
      method: 'POST',
      url: '/miranda/conversations/direct',
      headers: { ...authAsSession(empA.sessionToken), 'content-type': 'application/json' },
      payload: { targetCorporateAccountId: empB.accountId }
    });
    expect(direct.statusCode).toBe(400);
    expect(direct.json().error).toBe('not_active');
  });

  it('§A — глобальная админка: один админ создаёт/видит/деактивирует точечные аккаунты; список без org_id показывает весь текущий дилер', async () => {
    const app = await getApp();
    const dealer = await fx.createDealer();
    const sector = await fx.createSector(undefined, dealer);
    const orgA = await fx.createOrg('Dealer Admin Org A', sector);
    const orgB = await fx.createOrg('Dealer Admin Org B', sector);
    const foreignOrg = await fx.createOrg('Foreign Dealer Org');

    const adminA = await makeAdmin(orgA, '+79992000007', 'Админ-создатель A');

    const createInB = await app.inject({
      method: 'POST',
      url: '/miranda/accounts',
      headers: { ...authAsSession(adminA.sessionToken), 'content-type': 'application/json' },
      payload: { phone: '+79993000001', password: 'pass1234', accountName: 'Точка в сети B', orgId: orgB }
    });
    expect(createInB.statusCode).toBe(201);
    const pointAccountId = Number(createInB.json().item.id);
    corporateAccountIds.push(pointAccountId);
    expect(createInB.json().item.org_id).toBe(orgB);

    // GET без org_id показывает всю текущую дилерскую группу — точка из orgB видна.
    const listOwn = await app.inject({ method: 'GET', url: '/miranda/accounts', headers: authAsSession(adminA.sessionToken) });
    expect(listOwn.statusCode).toBe(200);
    expect(listOwn.json().items.some((i: any) => Number(i.corporate_account_id) === pointAccountId)).toBe(true);

    // Явный ?org_id=orgB сохраняет тот же дилерский скоуп.
    const listB = await app.inject({ method: 'GET', url: `/miranda/accounts?org_id=${encodeURIComponent(orgB)}`, headers: authAsSession(adminA.sessionToken) });
    expect(listB.statusCode).toBe(200);
    expect(listB.json().items.some((i: any) => Number(i.corporate_account_id) === pointAccountId)).toBe(true);

    // Сеть другого дилера, вообще без общего дилера с admin'ом — всё равно создаётся (глобальная админка).
    const createInForeign = await app.inject({
      method: 'POST',
      url: '/miranda/accounts',
      headers: { ...authAsSession(adminA.sessionToken), 'content-type': 'application/json' },
      payload: { phone: '+79993000002', password: 'pass1234', accountName: 'Точка в чужом дилере', orgId: foreignOrg }
    });
    expect(createInForeign.statusCode).toBe(201);
    const foreignAccountId = Number(createInForeign.json().item.id);
    corporateAccountIds.push(foreignAccountId);

    // §B — невалидный телефон отклоняется на создании, не сохраняется молча.
    const createBadPhone = await app.inject({
      method: 'POST',
      url: '/miranda/accounts',
      headers: { ...authAsSession(adminA.sessionToken), 'content-type': 'application/json' },
      payload: { phone: '12345', password: 'pass1234', accountName: 'Плохой телефон', orgId: orgA }
    });
    expect(createBadPhone.statusCode).toBe(400);
    expect(createBadPhone.json().error).toBe('invalid_phone');

    // §C — деактивация, глобально; аккаунт пропадает из списка (listAllCorporateAccounts фильтрует is_active).
    const deactivate = await app.inject({ method: 'POST', url: `/miranda/accounts/${foreignAccountId}/deactivate`, headers: authAsSession(adminA.sessionToken) });
    expect(deactivate.statusCode).toBe(200);
    const listForeignAfter = await app.inject({ method: 'GET', url: `/miranda/accounts?org_id=${encodeURIComponent(foreignOrg)}`, headers: authAsSession(adminA.sessionToken) });
    expect(listForeignAfter.json().items.some((i: any) => Number(i.corporate_account_id) === foreignAccountId)).toBe(false);

    const reactivate = await app.inject({ method: 'POST', url: `/miranda/accounts/${foreignAccountId}/reactivate`, headers: authAsSession(adminA.sessionToken) });
    expect(reactivate.statusCode).toBe(200);
  });
});
