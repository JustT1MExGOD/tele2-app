/**
 * Data Access Layer — SQL по таблице `feature_flags` (Admin Control
 * Center, Phase 4+, Area B1). Org-override-then-global resolution lives
 * in core/shared/feature-flags.ts's findEffective(); this module is pure SQL.
 */
import { query } from '../db/index.js';

export interface FeatureFlagRow {
  id: number;
  key: string;
  org_id: string | null;
  enabled: boolean;
  description: string | null;
  updated_by: number | null;
  updated_at: string;
}

export async function listAll(): Promise<FeatureFlagRow[]> {
  const res = await query(`SELECT * FROM feature_flags ORDER BY key ASC, org_id ASC NULLS FIRST`);
  return res.rows;
}

export async function findEffective(key: string, orgId: string | null): Promise<FeatureFlagRow | null> {
  const res = await query(
    `SELECT * FROM feature_flags WHERE key = $1 AND org_id = $2
     UNION ALL
     SELECT * FROM feature_flags WHERE key = $1 AND org_id IS NULL
     LIMIT 1`,
    [key, orgId]
  );
  return res.rows[0] || null;
}

export async function upsert(
  key: string, orgId: string | null, enabled: boolean, description: string | null, updatedBy: number | null
): Promise<FeatureFlagRow> {
  const res = await query(
    `INSERT INTO feature_flags (key, org_id, enabled, description, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (key, (COALESCE(org_id, ''))) DO UPDATE SET
       enabled = EXCLUDED.enabled, description = EXCLUDED.description,
       updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING *`,
    [key, orgId, enabled, description, updatedBy]
  );
  return res.rows[0];
}

export async function remove(key: string, orgId: string | null): Promise<boolean> {
  const res = await query(`DELETE FROM feature_flags WHERE key = $1 AND org_id IS NOT DISTINCT FROM $2`, [key, orgId]);
  return (res.rowCount ?? 0) > 0;
}
