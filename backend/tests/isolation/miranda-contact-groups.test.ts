/**
 * T2 Miranda — личные группы контактов (§2 плана) + статус "в сети" (§1
 * плана): владелец видит/редактирует только свои группы, чужой
 * corporate_account_id нельзя добавить из другой сети (org-изоляция),
 * presence_override меняет только свой же аккаунт.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAsSession } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import * as sessionsRepo from '../../src/data/repositories/sessions.js';

describe('T2 Miranda — группы контактов и presence', () => {
  const fx = new TestFixtures();
  const corporateAccountIds: number[] = [];
  const groupIds: number[] = [];

  afterAll(async () => {
    if (groupIds.length) {
      await query(`DELETE FROM miranda_contact_group_members WHERE group_id = ANY($1)`, [groupIds]);
      await query(`DELETE FROM miranda_contact_groups WHERE id = ANY($1)`, [groupIds]);
    }
    if (corporateAccountIds.length) {
      await query(`DELETE FROM miranda_contact_group_members WHERE member_corporate_account_id = ANY($1)`, [corporateAccountIds]);
      await query(`DELETE FROM miranda_contact_groups WHERE owner_corporate_account_id = ANY($1)`, [corporateAccountIds]);
      await query(`UPDATE employee_sessions SET active_corporate_account_id = NULL WHERE active_corporate_account_id = ANY($1)`, [corporateAccountIds]);
      await query(`DELETE FROM corporate_accounts WHERE id = ANY($1)`, [corporateAccountIds]);
    }
    await query(`DELETE FROM audit_log WHERE action LIKE 'MIRANDA_CONTACT_GROUP_%' OR action = 'MIRANDA_PRESENCE_SET'`);
    await fx.cleanup();
  });

  async function activeAccount(orgId: string, employeeId: number, token: string): Promise<number> {
    const acctRes = await query(
      `INSERT INTO corporate_accounts (org_id, employee_id, display_label) VALUES ($1, $2, $3) RETURNING id`,
      [orgId, employeeId, 'Тестовый аккаунт']
    );
    const corporateAccountId = Number(acctRes.rows[0].id);
    corporateAccountIds.push(corporateAccountId);
    await query(`UPDATE employee_sessions SET active_corporate_account_id = $2 WHERE token_hash = encode(sha256($1::bytea), 'hex')`, [token, corporateAccountId]);
    return corporateAccountId;
  }

  it('создаёт группу, добавляет контакт из своей сети, переименовывает, удаляет — всё аудируется', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Miranda Groups Org');
    const owner = await fx.createPhoneEmployee(org, '+79990100001', null, { role: 'employee', fullName: 'Владелец' });
    const ownerToken = await sessionsRepo.createSession(owner.id, false, 'employee');
    const ownerAccountId = await activeAccount(org, owner.id, ownerToken);

    const contact = await fx.createPhoneEmployee(org, '+79990100002', null, { role: 'employee', fullName: 'Коллега' });
    const contactAccountRes = await query(
      `INSERT INTO corporate_accounts (org_id, employee_id, display_label) VALUES ($1, $2, $3) RETURNING id`,
      [org, contact.id, 'Коллега']
    );
    const contactAccountId = Number(contactAccountRes.rows[0].id);
    corporateAccountIds.push(contactAccountId);

    const create = await app.inject({
      method: 'POST',
      url: '/miranda/groups',
      headers: { ...authAsSession(ownerToken), 'content-type': 'application/json' },
      payload: { name: 'Склад' }
    });
    expect(create.statusCode).toBe(201);
    const groupId = Number(create.json().item.id);
    groupIds.push(groupId);

    const dup = await app.inject({
      method: 'POST',
      url: '/miranda/groups',
      headers: { ...authAsSession(ownerToken), 'content-type': 'application/json' },
      payload: { name: 'Склад' }
    });
    expect(dup.statusCode).toBe(409);

    const addMember = await app.inject({
      method: 'POST',
      url: `/miranda/groups/${groupId}/members`,
      headers: { ...authAsSession(ownerToken), 'content-type': 'application/json' },
      payload: { corporateAccountId: contactAccountId }
    });
    expect(addMember.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/miranda/groups', headers: authAsSession(ownerToken) });
    expect(list.statusCode).toBe(200);
    const group = list.json().items.find((g: any) => Number(g.id) === groupId);
    expect(group.member_corporate_account_ids.map(Number)).toContain(contactAccountId);

    const rename = await app.inject({
      method: 'PATCH',
      url: `/miranda/groups/${groupId}`,
      headers: { ...authAsSession(ownerToken), 'content-type': 'application/json' },
      payload: { name: 'Склад 2' }
    });
    expect(rename.statusCode).toBe(200);

    const removeMember = await app.inject({
      method: 'DELETE',
      url: `/miranda/groups/${groupId}/members/${contactAccountId}`,
      headers: authAsSession(ownerToken)
    });
    expect(removeMember.statusCode).toBe(200);

    const del = await app.inject({ method: 'DELETE', url: `/miranda/groups/${groupId}`, headers: authAsSession(ownerToken) });
    expect(del.statusCode).toBe(200);
    groupIds.splice(groupIds.indexOf(groupId), 1);

    const auditActions = await query(
      `SELECT action FROM audit_log WHERE target_type = 'miranda_contact_group' AND target_id = $1 ORDER BY id ASC`,
      [String(groupId)]
    );
    expect(auditActions.rows.map((r: any) => r.action)).toEqual(
      expect.arrayContaining([
        'MIRANDA_CONTACT_GROUP_CREATED',
        'MIRANDA_CONTACT_GROUP_MEMBER_ADDED',
        'MIRANDA_CONTACT_GROUP_RENAMED',
        'MIRANDA_CONTACT_GROUP_MEMBER_REMOVED',
        'MIRANDA_CONTACT_GROUP_DELETED'
      ])
    );
  });

  it('чужая группа — 404 на rename/delete/members; чужой из другой сети — 404 на добавление в группу', async () => {
    const app = await getApp();
    const orgA = await fx.createOrg('Miranda Groups Org A');
    const orgB = await fx.createOrg('Miranda Groups Org B');
    const owner = await fx.createPhoneEmployee(orgA, '+79990100003', null, { role: 'employee', fullName: 'Владелец A' });
    const ownerToken = await sessionsRepo.createSession(owner.id, false, 'employee');
    await activeAccount(orgA, owner.id, ownerToken);

    const stranger = await fx.createPhoneEmployee(orgA, '+79990100004', null, { role: 'employee', fullName: 'Посторонний A' });
    const strangerToken = await sessionsRepo.createSession(stranger.id, false, 'employee');
    await activeAccount(orgA, stranger.id, strangerToken);

    const otherOrgEmployee = await fx.createPhoneEmployee(orgB, '+79990100005', null, { role: 'employee', fullName: 'Сотрудник B' });
    const otherOrgAccountRes = await query(
      `INSERT INTO corporate_accounts (org_id, employee_id, display_label) VALUES ($1, $2, $3) RETURNING id`,
      [orgB, otherOrgEmployee.id, 'Чужая сеть']
    );
    const otherOrgAccountId = Number(otherOrgAccountRes.rows[0].id);
    corporateAccountIds.push(otherOrgAccountId);

    const create = await app.inject({
      method: 'POST',
      url: '/miranda/groups',
      headers: { ...authAsSession(ownerToken), 'content-type': 'application/json' },
      payload: { name: 'Личная группа' }
    });
    const groupId = Number(create.json().item.id);
    groupIds.push(groupId);

    const strangerRename = await app.inject({
      method: 'PATCH',
      url: `/miranda/groups/${groupId}`,
      headers: { ...authAsSession(strangerToken), 'content-type': 'application/json' },
      payload: { name: 'Угон' }
    });
    expect(strangerRename.statusCode).toBe(404);

    const strangerDelete = await app.inject({ method: 'DELETE', url: `/miranda/groups/${groupId}`, headers: authAsSession(strangerToken) });
    expect(strangerDelete.statusCode).toBe(404);

    const crossOrgMember = await app.inject({
      method: 'POST',
      url: `/miranda/groups/${groupId}/members`,
      headers: { ...authAsSession(ownerToken), 'content-type': 'application/json' },
      payload: { corporateAccountId: otherOrgAccountId }
    });
    expect(crossOrgMember.statusCode).toBe(404);
  });

  it('PATCH /miranda/presence — меняет только свой же статус, виден в /miranda/contacts/all как online', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Miranda Presence Org');
    const emp = await fx.createPhoneEmployee(org, '+79990100006', null, { role: 'employee', fullName: 'Статус-тест' });
    const token = await sessionsRepo.createSession(emp.id, false, 'employee');
    const accountId = await activeAccount(org, emp.id, token);

    const setOnline = await app.inject({
      method: 'PATCH',
      url: '/miranda/presence',
      headers: { ...authAsSession(token), 'content-type': 'application/json' },
      payload: { status: 'online' }
    });
    expect(setOnline.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/miranda/contacts/all', headers: authAsSession(token) });
    expect(list.statusCode).toBe(200);
    const self = list.json().items.find((i: any) => Number(i.corporate_account_id) === accountId);
    expect(self.online).toBe(true);

    const setOffline = await app.inject({
      method: 'PATCH',
      url: '/miranda/presence',
      headers: { ...authAsSession(token), 'content-type': 'application/json' },
      payload: { status: 'offline' }
    });
    expect(setOffline.statusCode).toBe(200);

    const list2 = await app.inject({ method: 'GET', url: '/miranda/contacts/all', headers: authAsSession(token) });
    const self2 = list2.json().items.find((i: any) => Number(i.corporate_account_id) === accountId);
    expect(self2.online).toBe(false);

    const auditActions = await query(
      `SELECT action FROM audit_log WHERE action = 'MIRANDA_PRESENCE_SET' AND target_id = $1 ORDER BY id ASC`,
      [String(accountId)]
    );
    expect(auditActions.rows.length).toBeGreaterThanOrEqual(2);
  });
});
