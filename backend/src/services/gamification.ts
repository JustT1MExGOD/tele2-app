import { query } from '../db/index.js';

const LEVELS = [
  { level: 1, xp: 0, title: 'Стажёр' },
  { level: 2, xp: 100, title: 'Продавец' },
  { level: 3, xp: 300, title: 'Уверенный' },
  { level: 4, xp: 700, title: 'Профи' },
  { level: 5, xp: 1500, title: 'Топ' },
  { level: 6, xp: 3000, title: 'Легенда точки' },
  { level: 7, xp: 6000, title: 'Лидер сети' }
];

export function levelFromXp(xp: number) {
  let current = LEVELS[0];
  for (const L of LEVELS) {
    if (xp >= L.xp) current = L;
  }
  const next = LEVELS.find((l) => l.xp > xp) || null;
  return {
    level: current.level,
    title: current.title,
    xp,
    next_level_xp: next?.xp ?? null,
    progress_pct: next
      ? Math.round(((xp - current.xp) / (next.xp - current.xp)) * 100)
      : 100
  };
}

export async function addXp(employeeId: number, amount: number, reason: string, ref?: { type?: string; id?: string }) {
  await query(
    `INSERT INTO xp_events (employee_id, amount, reason, ref_type, ref_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [employeeId, amount, reason, ref?.type || null, ref?.id || null]
  );
  const res = await query(
    `UPDATE employees
     SET xp = COALESCE(xp,0) + $1,
         level = GREATEST(COALESCE(level,1), 1)
     WHERE id = $2
     RETURNING id, xp, level, streak_days, best_shift_score`,
    [amount, employeeId]
  );
  const row = res.rows[0];
  if (!row) return null;
  const info = levelFromXp(num(row.xp));
  await query(`UPDATE employees SET level = $1 WHERE id = $2`, [info.level, employeeId]);
  return { ...row, ...info };
}

export async function grantBadge(employeeId: number, code: string, title: string, meta: any = {}) {
  try {
    await query(
      `INSERT INTO employee_badges (employee_id, badge_code, title, meta)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT DO NOTHING`,
      [employeeId, code, title, JSON.stringify(meta)]
    );
  } catch {
    // unique may differ — ignore duplicates
  }
}

export async function evaluateAfterSale(employeeId: number, metrics: Record<string, number>) {
  let xp = 0;
  xp += (metrics.sim || 0) * 5;
  xp += (metrics.mnp || 0) * 15;
  xp += (metrics.pa || 0) * 20;
  xp += (metrics.combo || 0) * 12;
  if (xp > 0) await addXp(employeeId, xp, 'sale');
  return xp;
}

export async function evaluateShiftClose(opts: {
  employeeId: number;
  score: number;
  ideal: boolean;
  planPct: number;
}) {
  const before = await query(`SELECT xp FROM employees WHERE id = $1`, [opts.employeeId]);
  const levelBefore = levelFromXp(num(before.rows[0]?.xp)).level;

  let xp = 20;
  if (opts.planPct >= 100) xp += 50;
  if (opts.ideal) xp += 80;
  await addXp(opts.employeeId, xp, opts.ideal ? 'ideal_shift' : 'shift_close');

  if (opts.ideal) {
    await grantBadge(opts.employeeId, 'ideal_shift', 'Идеальная смена', { score: opts.score });
  }

  // streak: продажа/смена сегодня
  await query(
    `UPDATE employees SET
       streak_days = CASE
         WHEN best_shift_score IS NOT NULL THEN COALESCE(streak_days,0) + 1
         ELSE 1
       END,
       best_shift_score = GREATEST(COALESCE(best_shift_score,0), $1)
     WHERE id = $2`,
    [opts.score, opts.employeeId]
  );

  const st = await query(`SELECT streak_days, xp, level FROM employees WHERE id = $1`, [opts.employeeId]);
  const streak = num(st.rows[0]?.streak_days);
  if (streak === 7) await grantBadge(opts.employeeId, 'streak_7', '7 дней подряд');
  if (streak === 30) await grantBadge(opts.employeeId, 'streak_30', '30 дней огня');

  const info = levelFromXp(num(st.rows[0]?.xp));
  return {
    ...info,
    xp_gained: xp,
    leveled_up: info.level > levelBefore,
    streak_days: streak
  };
}

export async function getGamificationProfile(employeeId: number) {
  const emp = await query(
    `SELECT id, full_name, xp, level, streak_days, best_shift_score FROM employees WHERE id = $1`,
    [employeeId]
  );
  if (!emp.rows[0]) return null;
  const badges = await query(
    `SELECT badge_code, title, earned_at, meta FROM employee_badges
     WHERE employee_id = $1 ORDER BY earned_at DESC LIMIT 20`,
    [employeeId]
  );
  return {
    ...levelFromXp(num(emp.rows[0].xp)),
    streak_days: num(emp.rows[0].streak_days),
    best_shift_score: num(emp.rows[0].best_shift_score),
    badges: badges.rows
  };
}

function num(v: any) {
  return Number(v) || 0;
}
