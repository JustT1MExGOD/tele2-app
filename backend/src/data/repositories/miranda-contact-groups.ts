/**
 * T2 Miranda — группы контактов, общие для всей сети (настраивает
 * администратор — см. requireAdmin на мутациях в
 * api/routes/miranda/contact-groups.ts), с вложенностью (parent_group_id).
 * SQL — migrations/0043_miranda_contact_groups_and_presence.sql +
 * migrations/0044_miranda_contact_groups_shared_nested.sql.
 */
import { query } from '../db/index.js';

export interface ContactGroupRow {
  id: number;
  org_id: string;
  parent_group_id: number | null;
  name: string;
  sort_order: number;
}

export interface ContactGroupWithMembers extends ContactGroupRow {
  member_corporate_account_ids: number[];
}

export async function listGroupsWithMembers(orgIds: string[]): Promise<ContactGroupWithMembers[]> {
  const res = await query(
    `SELECT g.id, g.org_id, g.parent_group_id, g.name, g.sort_order,
            COALESCE(array_agg(m.member_corporate_account_id) FILTER (WHERE m.member_corporate_account_id IS NOT NULL), '{}') AS member_corporate_account_ids
     FROM miranda_contact_groups g
     LEFT JOIN miranda_contact_group_members m ON m.group_id = g.id
     WHERE g.org_id = ANY($1::text[])
     GROUP BY g.id
     ORDER BY g.sort_order ASC, g.id ASC`,
    [orgIds]
  );
  return res.rows;
}

export async function getGroup(id: number, q: typeof query = query): Promise<ContactGroupRow | null> {
  const res = await q(`SELECT id, org_id, parent_group_id, name, sort_order FROM miranda_contact_groups WHERE id = $1`, [id]);
  return res.rows[0] || null;
}

/** Сиблинги (тот же parentGroupId, тот же дилер) не дублируются по
 * названию — проверка по всему dealerOrgIds, а не только своей сети
 * (группы общие для дилера) и вставка в одной транзакции (вызывающая
 * сторона уже внутри withTransaction), возвращает null при дубле, роут
 * отвечает явным 409. Сама строка пишется с org_id создающего админа —
 * чисто происхождение, на видимость не влияет (см. dealerOrgIds). */
export async function createGroup(
  orgId: string,
  dealerOrgIds: string[],
  name: string,
  parentGroupId: number | null,
  createdByEmployeeId: number | null,
  q: typeof query = query
): Promise<ContactGroupRow | null> {
  const existing = await q(
    parentGroupId === null
      ? `SELECT 1 FROM miranda_contact_groups WHERE org_id = ANY($1::text[]) AND parent_group_id IS NULL AND name = $2`
      : `SELECT 1 FROM miranda_contact_groups WHERE org_id = ANY($1::text[]) AND parent_group_id = $2 AND name = $3`,
    parentGroupId === null ? [dealerOrgIds, name] : [dealerOrgIds, parentGroupId, name]
  );
  if (existing.rows.length > 0) return null;
  const res = await q(
    `INSERT INTO miranda_contact_groups (org_id, parent_group_id, name, created_by_employee_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, org_id, parent_group_id, name, sort_order`,
    [orgId, parentGroupId, name, createdByEmployeeId]
  );
  return res.rows[0] || null;
}

export async function renameGroup(id: number, name: string, q: typeof query = query): Promise<ContactGroupRow | null> {
  const res = await q(
    `UPDATE miranda_contact_groups SET name = $2 WHERE id = $1
     RETURNING id, org_id, parent_group_id, name, sort_order`,
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
