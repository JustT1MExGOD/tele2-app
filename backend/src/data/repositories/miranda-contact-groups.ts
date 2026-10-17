/**
 * T2 Miranda — личные группы контактов (§2 плана settings/groups).
 * Группы принадлежат одному corporate_account (owner_corporate_account_id),
 * как папки в легаси Miranda NG — не общесетевые сущности. SQL —
 * migrations/0043_miranda_contact_groups_and_presence.sql.
 */
import { query } from '../db/index.js';

export interface ContactGroupRow {
  id: number;
  org_id: string;
  owner_corporate_account_id: number;
  name: string;
  sort_order: number;
}

export interface ContactGroupWithMembers extends ContactGroupRow {
  member_corporate_account_ids: number[];
}

export async function listGroupsWithMembers(ownerId: number): Promise<ContactGroupWithMembers[]> {
  const res = await query(
    `SELECT g.id, g.org_id, g.owner_corporate_account_id, g.name, g.sort_order,
            COALESCE(array_agg(m.member_corporate_account_id) FILTER (WHERE m.member_corporate_account_id IS NOT NULL), '{}') AS member_corporate_account_ids
     FROM miranda_contact_groups g
     LEFT JOIN miranda_contact_group_members m ON m.group_id = g.id
     WHERE g.owner_corporate_account_id = $1
     GROUP BY g.id
     ORDER BY g.sort_order ASC, g.id ASC`,
    [ownerId]
  );
  return res.rows;
}

export async function getGroup(id: number, q: typeof query = query): Promise<ContactGroupRow | null> {
  const res = await q(`SELECT id, org_id, owner_corporate_account_id, name, sort_order FROM miranda_contact_groups WHERE id = $1`, [id]);
  return res.rows[0] || null;
}

/** UNIQUE(owner_corporate_account_id, name) — повтор названия возвращает
 * null, роут отвечает явным 409, не тихо подсовывает существующую группу. */
export async function createGroup(
  orgId: string,
  ownerId: number,
  name: string,
  q: typeof query = query
): Promise<ContactGroupRow | null> {
  const res = await q(
    `INSERT INTO miranda_contact_groups (org_id, owner_corporate_account_id, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (owner_corporate_account_id, name) DO NOTHING
     RETURNING id, org_id, owner_corporate_account_id, name, sort_order`,
    [orgId, ownerId, name]
  );
  return res.rows[0] || null;
}

export async function renameGroup(id: number, name: string, q: typeof query = query): Promise<ContactGroupRow | null> {
  const res = await q(
    `UPDATE miranda_contact_groups SET name = $2 WHERE id = $1
     RETURNING id, org_id, owner_corporate_account_id, name, sort_order`,
    [id, name]
  );
  return res.rows[0] || null;
}

export async function deleteGroup(id: number, q: typeof query = query): Promise<boolean> {
  const res = await q(`DELETE FROM miranda_contact_groups WHERE id = $1`, [id]);
  return (res.rowCount ?? 0) > 0;
}

export async function addMember(groupId: number, memberCorporateAccountId: number, q: typeof query = query): Promise<void> {
  await q(
    `INSERT INTO miranda_contact_group_members (group_id, member_corporate_account_id)
     VALUES ($1, $2)
     ON CONFLICT (group_id, member_corporate_account_id) DO NOTHING`,
    [groupId, memberCorporateAccountId]
  );
}

export async function removeMember(groupId: number, memberCorporateAccountId: number, q: typeof query = query): Promise<void> {
  await q(`DELETE FROM miranda_contact_group_members WHERE group_id = $1 AND member_corporate_account_id = $2`, [groupId, memberCorporateAccountId]);
}
