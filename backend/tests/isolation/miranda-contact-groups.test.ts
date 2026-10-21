/**
 * T2 Miranda — группы контактов, общие для всей сети (§2 плана, пересмотр:
 * не личный контакт-лист, а разметка, которую задаёт администратор для
 * всех) + статус "в сети" (§1 плана): только requireAdmin может
 * создавать/переименовывать/удалять группы и управлять составом, но
 * читает дерево (GET) любой принципал сети; вложенность (parent_group_id)
 * работает и валидируется на ту же сеть; чужая сеть — 404/403; presence
 * меняет только свой же аккаунт.
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

  it('админ создаёт вложенную группу, добавляет контакт, переименовывает, удаляет (каскадом сносит подгруппу) — всё аудируется, читает и обычный сотрудник', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Miranda Groups Org');
    const admin = await fx.createPhoneEmployee(org, '+79990100001', null, { role: 'admin', fullName: 'Админ' });
    await fx.enrollTotpFor(admin.id);
    const adminToken = await sessionsRepo.createSession(admin.id, true, 'admin');
    await activeAccount(org, admin.id, adminToken);

    const employee = await fx.createPhoneEmployee(org, '+79990100002', null, { role: 'employee', fullName: 'Сотрудник' });
    const employeeToken = await sessionsRepo.createSession(employee.id, false, 'employee');
    await activeAccount(org, employee.id, employeeToken);

    const contact = await fx.createPhoneEmployee(org, '+79990100003', null, { role: 'employee', fullName: 'Коллега' });
    const contactAccountRes = await query(
      `INSERT INTO corporate_accounts (org_id, employee_id, display_label) VALUES ($1, $2, $3) RETURNING id`,
      [org, contact.id, 'Коллега']
    );
    const contactAccountId = Number(contactAccountRes.rows[0].id);
    corporateAccountIds.push(contactAccountId);

    const create = await app.inject({
      method: 'POST',
      url: '/miranda/groups',
      headers: { ...authAsSession(adminToken), 'content-type': 'application/json' },
      payload: { name: 'Склад' }
    });
    expect(create.statusCode).toBe(201);
    const groupId = Number(create.json().item.id);
    groupIds.push(groupId);

    // не-админ не может создавать/мутировать группы.
    const forbidden = await app.inject({
      method: 'POST',
      url: '/miranda/groups',
      headers: { ...authAsSession(employeeToken), 'content-type': 'application/json' },
      payload: { name: 'Чужая попытка' }
    });
    expect(forbidden.statusCode).toBe(403);

    const dup = await app.inject({
      method: 'POST',
      url: '/miranda/groups',
      headers: { ...authAsSession(adminToken), 'content-type': 'application/json' },
      payload: { name: 'Склад' }
    });
    expect(dup.statusCode).toBe(409);

    // вложенная подгруппа — та же сеть, валидный parentGroupId.
    const createSub = await app.inject({
      method: 'POST',
      url: '/miranda/groups',
      headers: { ...authAsSession(adminToken), 'content-type': 'application/json' },
      payload: { name: 'Смена A', parentGroupId: groupId }
    });
    expect(createSub.statusCode).toBe(201);
    const subGroupId = Number(createSub.json().item.id);
    expect(Number(createSub.json().item.parent_group_id)).toBe(groupId);
    groupIds.push(subGroupId);

    const addMember = await app.inject({
      method: 'POST',
      url: `/miranda/groups/${groupId}/members`,
      headers: { ...authAsSession(adminToken), 'content-type': 'application/json' },
      payload: { corporateAccountId: contactAccountId }
    });
    expect(addMember.statusCode).toBe(200);

    // читает (GET) любой принципал сети, не только админ.
    const list = await app.inject({ method: 'GET', url: '/miranda/groups', headers: authAsSession(employeeToken) });
    expect(list.statusCode).toBe(200);
    const group = list.json().items.find((g: any) => Number(g.id) === groupId);
    expect(group.member_corporate_account_ids.map(Number)).toContain(contactAccountId);
    const sub = list.json().items.find((g: any) => Number(g.id) === subGroupId);
    expect(Number(sub.parent_group_id)).toBe(groupId);

    const rename = await app.inject({
      method: 'PATCH',
      url: `/miranda/groups/${groupId}`,
      headers: { ...authAsSession(adminToken), 'content-type': 'application/json' },
      payload: { name: 'Склад 2' }
    });
    expect(rename.statusCode).toBe(200);

    const afterRename = await app.inject({ method: 'GET', url: '/miranda/groups', headers: authAsSession(employeeToken) });
    expect(afterRename.json().items.find((g: any) => Number(g.id) === groupId).name).toBe('Склад 2');

    const removeMember = await app.inject({
      method: 'DELETE',
      url: `/miranda/groups/${groupId}/members/${contactAccountId}`,
      headers: authAsSession(adminToken)
    });
    expect(removeMember.statusCode).toBe(200);

    // удаление родителя каскадом сносит подгруппу (ON DELETE CASCADE на parent_group_id).
    const del = await app.inject({ method: 'DELETE', url: `/miranda/groups/${groupId}`, headers: authAsSession(adminToken) });
    expect(del.statusCode).toBe(200);
    groupIds.splice(groupIds.indexOf(groupId), 1);
    groupIds.splice(groupIds.indexOf(subGroupId), 1);

    const afterDelete = await app.inject({ method: 'GET', url: '/miranda/groups', headers: authAsSession(employeeToken) });
    expect(afterDelete.json().items.some((g: any) => Number(g.id) === subGroupId)).toBe(false);

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

  it('§A — глобальная админка: админ любой сети управляет группой другой сети (rename/delete/member/parentGroupId); не-админ своей сети — всё ещё 403', async () => {
    const app = await getApp();
    const orgA = await fx.createOrg('Miranda Groups Org A');
    const orgB = await fx.createOrg('Miranda Groups Org B');
    const adminA = await fx.createPhoneEmployee(orgA, '+79990100004', null, { role: 'admin', fullName: 'Админ A' });
    await fx.enrollTotpFor(adminA.id);
    const adminAToken = await sessionsRepo.createSession(adminA.id, true, 'admin');
    await activeAccount(orgA, adminA.id, adminAToken);

    const adminB = await fx.createPhoneEmployee(orgB, '+79990100005', null, { role: 'admin', fullName: 'Админ B' });
    await fx.enrollTotpFor(adminB.id);
    const adminBToken = await sessionsRepo.createSession(adminB.id, true, 'admin');
    await activeAccount(orgB, adminB.id, adminBToken);

    const nonAdminA = await fx.createPhoneEmployee(orgA, '+79990100006', null, { role: 'employee', fullName: 'Сотрудник A' });
    const nonAdminAToken = await sessionsRepo.createSession(nonAdminA.id, false, 'employee');
    await activeAccount(orgA, nonAdminA.id, nonAdminAToken);

    const otherOrgEmployee = await fx.createPhoneEmployee(orgB, '+79990100007', null, { role: 'employee', fullName: 'Сотрудник B' });
    const otherOrgAccountRes = await query(
      `INSERT INTO corporate_accounts (org_id, employee_id, display_label) VALUES ($1, $2, $3) RETURNING id`,
      [orgB, otherOrgEmployee.id, 'Чужая сеть']
    );
    const otherOrgAccountId = Number(otherOrgAccountRes.rows[0].id);
    corporateAccountIds.push(otherOrgAccountId);

    const create = await app.inject({
      method: 'POST',
      url: '/miranda/groups',
      headers: { ...authAsSession(adminAToken), 'content-type': 'application/json' },
      payload: { name: 'Группа сети A' }
    });
    const groupId = Number(create.json().item.id);
    groupIds.push(groupId);

    // Админ B (другая сеть, другой дилер по умолчанию в фикстурах без
    // sector) переименовывает группу сети A — глобальная админка, 200.
    const crossOrgRename = await app.inject({
      method: 'PATCH',
      url: `/miranda/groups/${groupId}`,
      headers: { ...authAsSession(adminBToken), 'content-type': 'application/json' },
      payload: { name: 'Угон' }
    });
    expect(crossOrgRename.statusCode).toBe(200);

    const sameOrgNonAdminRename = await app.inject({
      method: 'PATCH',
      url: `/miranda/groups/${groupId}`,
      headers: { ...authAsSession(nonAdminAToken), 'content-type': 'application/json' },
      payload: { name: 'Попытка не-админа' }
    });
    expect(sameOrgNonAdminRename.statusCode).toBe(403);

    // Админ A добавляет в группу контакт сети B — глобальная админка, 200.
    const crossOrgMember = await app.inject({
      method: 'POST',
      url: `/miranda/groups/${groupId}/members`,
      headers: { ...authAsSession(adminAToken), 'content-type': 'application/json' },
      payload: { corporateAccountId: otherOrgAccountId }
    });
    expect(crossOrgMember.statusCode).toBe(200);

    // Админ B (своя сеть — orgB) явно создаёт подгруппу В СЕТИ A
    // (orgId: orgA) с parentGroupId = группа сети A — глобальная
    // админка позволяет управлять чужой сетью напрямую, 201. Родитель
    // и потомок в одной сети (orgA) — дилер-containment не нарушается.
    const crossOrgParent = await app.inject({
      method: 'POST',
      url: '/miranda/groups',
      headers: { ...authAsSession(adminBToken), 'content-type': 'application/json' },
      payload: { name: 'Подгруппа из чужой сети', parentGroupId: groupId, orgId: orgA }
    });
    expect(crossOrgParent.statusCode).toBe(201);
    groupIds.push(Number(crossOrgParent.json().item.id));

    const crossOrgDelete = await app.inject({ method: 'DELETE', url: `/miranda/groups/${groupId}`, headers: authAsSession(adminBToken) });
    expect(crossOrgDelete.statusCode).toBe(200);
  });

  it('PATCH /miranda/presence — меняет только свой же статус, виден в /miranda/contacts/all как online', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Miranda Presence Org');
    const emp = await fx.createPhoneEmployee(org, '+79990100008', null, { role: 'employee', fullName: 'Статус-тест' });
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
