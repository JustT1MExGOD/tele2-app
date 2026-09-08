/**
 * Вывод времени смены — детерминированное бизнес-правило, НЕ решение
 * солвера (перенесено из core/schedule/schedule-generator.ts, 20.58.0
 * split). storeFullShiftHours/deriveShift используются и MILP-моделью
 * (candidates.ts), и приложением для итогового shift_text/hours.
 */
import type { StoreRecord } from '../../../data/repositories/stores.js';
import { weekdayMonday0 } from './weekday.js';
import * as W from './weights.js';

export function timeToHours(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h + (m || 0) / 60;
}

export function hoursToTime(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function storeOpenClose(store: StoreRecord, dateIso: string): { open: string; close: string } {
  const isSunday = weekdayMonday0(dateIso) === 6;
  return {
    open: isSunday ? (store.open_time_sunday || store.open_time_weekday) : store.open_time_weekday,
    close: isSunday ? (store.close_time_sunday || store.close_time_weekday) : store.close_time_weekday
  };
}

export function storeFullShiftHours(store: StoreRecord, dateIso: string): number {
  const { open, close } = storeOpenClose(store, dateIso);
  let h = timeToHours(close) - timeToHours(open);
  if (h <= 0) h += 24;
  return h;
}

export function deriveShift(store: StoreRecord, dateIso: string, isTrainee: boolean): { shift_text: string; hours: number } {
  const { open, close } = storeOpenClose(store, dateIso);
  const openH = timeToHours(open);
  const endH = isTrainee ? openH + W.TRAINEE_SHIFT_HOURS : timeToHours(close) <= openH ? timeToHours(close) + 24 : timeToHours(close);
  const hours = Math.round(endH - openH);
  return { shift_text: `${hoursToTime(openH)}-${hoursToTime(endH)}`, hours };
}

