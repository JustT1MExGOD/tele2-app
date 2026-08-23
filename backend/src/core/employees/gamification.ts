import * as repo from '../../data/repositories/gamification.js';

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
  await repo.insertXpEvent(employeeId, amount, reason, ref?.type || null, ref?.id || null);
  const row = await repo.addXpToEmployee(employeeId, amount);
  if (!row) return null;
  const info = levelFromXp(num(row.xp));
  await repo.setLevel(employeeId, info.level);
  return { ...row, ...info };
}

export async function grantBadge(employeeId: number, code: string, title: string, meta: any = {}) {
  try {
    await repo.insertBadge(employeeId, code, title, JSON.stringify(meta));
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
  const beforeXp = await repo.findXp(opts.employeeId);
  const levelBefore = levelFromXp(num(beforeXp)).level;

  let xp = 20;
  if (opts.planPct >= 100) xp += 50;
  if (opts.ideal) xp += 80;
  await addXp(opts.employeeId, xp, opts.ideal ? 'ideal_shift' : 'shift_close');

  if (opts.ideal) {
    await grantBadge(opts.employeeId, 'ideal_shift', 'Идеальная смена', { score: opts.score });
  }

  // streak: продажа/смена сегодня
  await repo.updateStreakAndBestScore(opts.employeeId, opts.score);

  const st = await repo.findStreakXpLevel(opts.employeeId);
  const streak = num(st?.streak_days);
  if (streak === 7) await grantBadge(opts.employeeId, 'streak_7', '7 дней подряд');
  if (streak === 30) await grantBadge(opts.employeeId, 'streak_30', '30 дней огня');

  const info = levelFromXp(num(st?.xp));
  return {
    ...info,
    xp_gained: xp,
    leveled_up: info.level > levelBefore,
    streak_days: streak
  };
}

export async function getGamificationProfile(employeeId: number) {
  const emp = await repo.findProfileBasic(employeeId);
  if (!emp) return null;
  const badges = await repo.listBadges(employeeId);
  return {
    ...levelFromXp(num(emp.xp)),
    streak_days: num(emp.streak_days),
    best_shift_score: num(emp.best_shift_score),
    badges
  };
}

function num(v: any) {
  return Number(v) || 0;
}
