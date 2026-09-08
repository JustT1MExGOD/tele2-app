/**
 * Дата/день-недели helpers для домена schedules. weekdayMonday0 —
 * ЕДИНСТВЕННОЕ место во всём модуле, где вообще вычисляется день недели
 * даты (0=понедельник..6=воскресенье, конвенция БД) — Date.getDay() (0=Вс)
 * нигде больше в модуле напрямую не вызывается.
 */
import { todayMoscow } from '../../../utils/date.js';

export function weekdayMonday0(dateIso: string): number {
  const [y, m, d] = dateIso.slice(0, 10).split('-').map(Number);
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sunday..6=Saturday, но НЕ Date.getDay()
  return (jsDay + 6) % 7;
}

export function addDaysIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

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

export function daysInMonth(startIso: string): string[] {
  const start = monthStart(startIso);
  const end = monthAdd(start, 1);
  const out: string[] = [];
  for (let d = start; d < end; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

export function defaultTargetMonth(asOf = todayMoscow()): string {
  return monthStart(asOf.slice(0, 7));
}

