/**
 * Data Access Layer — T2 Academy (redesigned tutorial) progress/XP/badges.
 * Deliberately separate tables from production gamification (xp_events,
 * employee_badges) — see migrations/0032_academy.sql's own doc comment.
 */
import { query } from '../db/index.js';

/** Idempotent — ON CONFLICT DO NOTHING on (employee_id, step_id). Returns
 * whether this call was the one that actually inserted the row (first
 * completion), so callers can gate one-time rewards (XP/badge) on it
 * without a second round-trip. */
export async function markStepCompleted(employeeId: number, stepId: string): Promise<{ isNew: boolean }> {
  const res = await query(
    `INSERT INTO academy_progress (employee_id, step_id) VALUES ($1, $2)
     ON CONFLICT (employee_id, step_id) DO NOTHING
     RETURNING id`,
    [employeeId, stepId]
  );
  return { isNew: res.rows.length > 0 };
}

export async function findCompletedStepIds(employeeId: number): Promise<string[]> {
  const res = await query(`SELECT step_id FROM academy_progress WHERE employee_id = $1`, [employeeId]);
  return res.rows.map((r: any) => r.step_id as string);
}

export async function hasAcademyBadge(employeeId: number, code: string): Promise<boolean> {
  const res = await query(`SELECT 1 FROM academy_badges WHERE employee_id = $1 AND code = $2 LIMIT 1`, [employeeId, code]);
  return res.rows.length > 0;
}

export async function grantAcademyBadge(employeeId: number, code: string, title: string): Promise<void> {
  await query(`INSERT INTO academy_badges (employee_id, code, title) VALUES ($1, $2, $3)`, [employeeId, code, title]);
}

export async function addAcademyXp(employeeId: number, amount: number, reason: string): Promise<void> {
  await query(`INSERT INTO academy_xp_events (employee_id, amount, reason) VALUES ($1, $2, $3)`, [employeeId, amount, reason]);
}

export async function getAcademyXpTotal(employeeId: number): Promise<number> {
  const res = await query(`SELECT COALESCE(SUM(amount),0) as total FROM academy_xp_events WHERE employee_id = $1`, [employeeId]);
  return Number(res.rows[0]?.total) || 0;
}

export async function findAcademyBadges(employeeId: number): Promise<{ code: string; title: string; earned_at: string }[]> {
  const res = await query(`SELECT code, title, earned_at FROM academy_badges WHERE employee_id = $1 ORDER BY earned_at`, [employeeId]);
  return res.rows;
}

export async function hasDismissedContextual(employeeId: number, contextId: string): Promise<boolean> {
  const res = await query(
    `SELECT 1 FROM academy_contextual_dismissals WHERE employee_id = $1 AND context_id = $2 LIMIT 1`,
    [employeeId, contextId]
  );
  return res.rows.length > 0;
}

export async function dismissContextual(employeeId: number, contextId: string): Promise<void> {
  await query(
    `INSERT INTO academy_contextual_dismissals (employee_id, context_id) VALUES ($1, $2)
     ON CONFLICT (employee_id, context_id) DO NOTHING`,
    [employeeId, contextId]
  );
}
