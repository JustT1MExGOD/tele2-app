/**
 * Data Access Layer (20.8.0, Full DAL) — app_settings (single-row key/value config).
 */
import { query } from '../db/index.js';

/** services/release-announce.ts::claimReleaseAnnouncement — атомарный conditional claim. */
export async function claimIfChanged(key: string, value: string): Promise<boolean> {
  const res = await query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
     WHERE app_settings.value IS DISTINCT FROM EXCLUDED.value
     RETURNING value`,
    [key, value]
  );
  return !!res.rows[0];
}
