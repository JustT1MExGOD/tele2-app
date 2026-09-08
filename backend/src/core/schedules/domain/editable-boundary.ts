/**
 * editableFromDate — единая глобальная граница редактируемости текущего
 * месяца (см. план synthetic-roaming-mountain, round 9): как только хоть
 * одна активная точка сети открылась сегодня — весь текущий календарный
 * день замораживается целиком.
 */
import type { StoreRecord } from '../../../data/repositories/stores.js';
import { weekdayMonday0, monthStart, addDaysIso } from './weekday.js';
import { timeToHours } from './shift-time.js';
import { todayMoscow, nowTimeMoscow } from '../../../utils/date.js';

export function computeEditableFromDateToday(activeStores: StoreRecord[], today: string, nowTime: string): string {
  if (!activeStores.length) return addDaysIso(today, 1);
  const isSunday = weekdayMonday0(today) === 6;
  let earliest = Infinity;
  for (const s of activeStores) {
    const o = isSunday ? (s.open_time_sunday || s.open_time_weekday) : s.open_time_weekday;
    earliest = Math.min(earliest, timeToHours(o));
  }
  return timeToHours(nowTime) < earliest ? today : addDaysIso(today, 1);
}

export function resolveEditableFromDate(targetMonth: string, activeStores: StoreRecord[]): string {
  const today = todayMoscow();
  const targetStart = monthStart(targetMonth);
  if (targetStart !== monthStart(today.slice(0, 7))) return targetStart;
  return computeEditableFromDateToday(activeStores, today, nowTimeMoscow());
}

