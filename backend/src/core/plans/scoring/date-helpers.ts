/**
 * Local date helpers for the employee-plan-generator capability (distinct
 * from core/schedules/domain/weekday.ts's own — not consolidated in this
 * pass, see architecture plan scope notes).
 */
export function monthStart(month: string): string {
  return month.length === 7 ? `${month}-01` : month.slice(0, 10);
}

export function monthAdd(monthStartIso: string, delta: number): string {
  const [y, m] = monthStart(monthStartIso).split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}

export function todayMoscow(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

export function defaultTargetMonth(asOf = todayMoscow()): string {
  return monthAdd(monthStart(asOf.slice(0, 7)), 1);
}

