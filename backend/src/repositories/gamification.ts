import { query } from '../db/index.js';

export async function insertXpEvent(employeeId: number, amount: number, reason: string, refType: string | null, refId: string | null): Promise<void> {
  await query(
    `INSERT INTO xp_events (employee_id, amount, reason, ref_type, ref_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [employeeId, amount, reason, refType, refId]
  );
}

export async function addXpToEmployee(employeeId: number, amount: number): Promise<{ id: number; xp: number; level: number; streak_days: number; best_shift_score: number } | null> {
  const res = await query(
    `UPDATE employees
     SET xp = COALESCE(xp,0) + $1,
         level = GREATEST(COALESCE(level,1), 1)
     WHERE id = $2
     RETURNING id, xp, level, streak_days, best_shift_score`,
    [amount, employeeId]
  );
  return res.rows[0] || null;
}

export async function setLevel(employeeId: number, level: number): Promise<void> {
  await query(`UPDATE employees SET level = $1 WHERE id = $2`, [level, employeeId]);
}

export async function insertBadge(employeeId: number, code: string, title: string, meta: string): Promise<void> {
  await query(
    `INSERT INTO employee_badges (employee_id, badge_code, title, meta)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT DO NOTHING`,
    [employeeId, code, title, meta]
  );
}

export async function findXp(employeeId: number): Promise<number | null> {
  const res = await query(`SELECT xp FROM employees WHERE id = $1`, [employeeId]);
  return res.rows[0]?.xp ?? null;
}

export async function updateStreakAndBestScore(employeeId: number, score: number): Promise<void> {
  await query(
    `UPDATE employees SET
       streak_days = CASE
         WHEN best_shift_score IS NOT NULL THEN COALESCE(streak_days,0) + 1
         ELSE 1
       END,
       best_shift_score = GREATEST(COALESCE(best_shift_score,0), $1)
     WHERE id = $2`,
    [score, employeeId]
  );
}

export async function findStreakXpLevel(employeeId: number): Promise<{ streak_days: number; xp: number; level: number } | null> {
  const res = await query(`SELECT streak_days, xp, level FROM employees WHERE id = $1`, [employeeId]);
  return res.rows[0] || null;
}

export async function findProfileBasic(employeeId: number): Promise<{ id: number; full_name: string; xp: number; level: number; streak_days: number; best_shift_score: number } | null> {
  const res = await query(
    `SELECT id, full_name, xp, level, streak_days, best_shift_score FROM employees WHERE id = $1`,
    [employeeId]
  );
  return res.rows[0] || null;
}

export async function listBadges(employeeId: number): Promise<any[]> {
  const res = await query(
    `SELECT badge_code, title, earned_at, meta FROM employee_badges
     WHERE employee_id = $1 ORDER BY earned_at DESC LIMIT 20`,
    [employeeId]
  );
  return res.rows;
}

/** POST /me/tutorial-complete — идемпотентность: не начислять XP второй раз. */
export async function hasBadge(employeeId: number, code: string): Promise<boolean> {
  const res = await query(
    `SELECT 1 FROM employee_badges WHERE employee_id = $1 AND badge_code = $2`,
    [employeeId, code]
  );
  return res.rows.length > 0;
}
