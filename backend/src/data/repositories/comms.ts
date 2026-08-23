/**
 * Data Access Layer (20.8.0, Full DAL) — объявления сети и каналы-обсуждения.
 */
import { query } from '../db/index.js';

export async function listActiveForEmployee(employeeId: number, orgId: string): Promise<any[]> {
  const res = await query(
    `SELECT a.*,
            EXISTS(
              SELECT 1 FROM announcement_reads r
              WHERE r.announcement_id = a.id AND r.employee_id = $1
            ) as is_read
     FROM announcements a
     WHERE a.active = true AND COALESCE(a.org_id,'default') = $2
     ORDER BY a.created_at DESC
     LIMIT 50`,
    [employeeId, orgId]
  );
  return res.rows;
}

export async function create(title: string, body: string, required: boolean | undefined, createdBy: number, orgId: string): Promise<any> {
  const res = await query(
    `INSERT INTO announcements (title, body, required, created_by, org_id)
     VALUES ($1,$2,COALESCE($3,true),$4,$5) RETURNING *`,
    [title, body, required, createdBy, orgId]
  );
  return res.rows[0];
}

export async function markRead(announcementId: number, employeeId: number): Promise<void> {
  await query(
    `INSERT INTO announcement_reads (announcement_id, employee_id)
     VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [announcementId, employeeId]
  );
}

export async function findOrgId(announcementId: string): Promise<string | null> {
  const res = await query(`SELECT COALESCE(org_id,'default') as org_id FROM announcements WHERE id = $1`, [announcementId]);
  return res.rows[0]?.org_id ?? null;
}

export async function listReads(announcementId: string, orgId: string): Promise<any[]> {
  const res = await query(
    `SELECT e.id, e.full_name, r.read_at
     FROM announcement_reads r
     JOIN employees e ON e.id = r.employee_id
     WHERE r.announcement_id = $1 AND COALESCE(e.org_id,'default') = $2
     ORDER BY r.read_at`,
    [announcementId, orgId]
  );
  return res.rows;
}

export async function listUnread(announcementId: string, orgId: string): Promise<any[]> {
  const res = await query(
    `SELECT e.id, e.full_name
     FROM employees e
     WHERE COALESCE(e.is_active, true) = true AND e.access_status = 'active'
       AND COALESCE(e.org_id,'default') = $2
       AND NOT EXISTS (
         SELECT 1 FROM announcement_reads r
         WHERE r.announcement_id = $1 AND r.employee_id = e.id
       )
     ORDER BY e.full_name`,
    [announcementId, orgId]
  );
  return res.rows;
}

export async function findChannelOrgId(channelId: string): Promise<string | null> {
  const res = await query(`SELECT COALESCE(org_id,'default') as org_id FROM channels WHERE id = $1`, [channelId]);
  return res.rows[0]?.org_id ?? null;
}

export async function listChannelMessages(channelId: string): Promise<any[]> {
  const res = await query(
    `SELECT m.*, e.full_name as author_name
     FROM channel_messages m
     LEFT JOIN employees e ON e.id = m.author_id
     WHERE m.channel_id = $1
     ORDER BY m.created_at DESC LIMIT 100`,
    [channelId]
  );
  return res.rows;
}

export async function createChannelMessage(channelId: string, authorId: number, body: string, dueAt: string | null): Promise<any> {
  const res = await query(
    `INSERT INTO channel_messages (channel_id, author_id, body, due_at)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [channelId, authorId, body, dueAt]
  );
  return res.rows[0];
}
