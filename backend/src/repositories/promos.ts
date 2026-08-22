/**
 * Data Access Layer (20.8.0, Full DAL) — промокоды RTK (rtk_promocodes).
 */
import { query } from '../db/index.js';

export async function listUnused(orgId: string): Promise<any[]> {
  const res = await query(
    `SELECT id, code, note, created_by, created_by_name, created_at
     FROM rtk_promocodes
     WHERE is_used = false AND COALESCE(org_id, 'default') = $1
     ORDER BY created_at DESC
     LIMIT 200`,
    [orgId]
  );
  return res.rows;
}

export async function findUnusedById(id: number, orgId: string): Promise<any | null> {
  const res = await query(
    `SELECT id, code, note, created_by_name, created_at
     FROM rtk_promocodes WHERE id = $1 AND is_used = false AND COALESCE(org_id, 'default') = $2`,
    [id, orgId]
  );
  return res.rows[0] || null;
}

export async function create(code: string, note: string | null, createdBy: number, createdByName: string, orgId: string): Promise<any> {
  const res = await query(
    `INSERT INTO rtk_promocodes (code, note, created_by, created_by_name, org_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, code, note, created_at`,
    [code, note, createdBy, createdByName, orgId]
  );
  return res.rows[0];
}

export async function markUsed(id: number, usedBy: number, orgId: string): Promise<boolean> {
  const res = await query(
    `UPDATE rtk_promocodes
     SET is_used = true, used_by = $2, used_at = now()
     WHERE id = $1 AND is_used = false AND COALESCE(org_id, 'default') = $3
     RETURNING id`,
    [id, usedBy, orgId]
  );
  return !!res.rows[0];
}
