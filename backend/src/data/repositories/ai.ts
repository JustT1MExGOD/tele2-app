/**
 * Data Access Layer (20.8.0, Full DAL) — ai_audit (лог AI-подсказок + кэш на день).
 */
import { query } from '../db/index.js';

export async function insertAudit(opts: {
  kind: string; employeeId: number | null; storeId: string | null; refDate: string | null;
  prompt: string; response: string; model: string;
}): Promise<void> {
  await query(
    `INSERT INTO ai_audit (kind, employee_id, store_id, ref_date, prompt, response, model)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [opts.kind, opts.employeeId, opts.storeId, opts.refDate, opts.prompt, opts.response, opts.model]
  ).catch((e) => console.warn('ai_audit insert failed:', e?.message || e));
}

export async function findLatestResponse(kind: string, storeId: string, date: string): Promise<string | null> {
  const res = await query(
    `SELECT response FROM ai_audit
     WHERE kind = $1 AND store_id = $2 AND ref_date = $3::date
     ORDER BY created_at DESC LIMIT 1`,
    [kind, storeId, date]
  ).catch(() => ({ rows: [] as any[] }));
  return res.rows[0]?.response || null;
}
