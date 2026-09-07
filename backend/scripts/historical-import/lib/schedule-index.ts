import { parseCsv } from './csv.js';
import { canonicalEmployeeName } from './employees.js';
import { storeIdForName } from './stores.js';

export interface ScheduleEntry {
  employeeName: string;
  date: string;
  status: 'working' | 'day_off';
  storeId: string | null;
  shiftStart: string | null;
  shiftEnd: string | null;
}

export type ScheduleIndex = Map<string, ScheduleEntry>;

function key(employeeName: string, date: string): string {
  return `${employeeName.normalize('NFC')} ${date}`;
}

/** Loads t2_legacy_schedules.csv (May–Jul 2026 coverage). */
export function loadMayJulSchedule(csvText: string): ScheduleIndex {
  const idx: ScheduleIndex = new Map();
  for (const row of parseCsv(csvText)) {
    if (row.record_type !== 'schedule') continue;
    const employeeName = canonicalEmployeeName(row.employee_name);
    const date = row.date;
    if (!date) continue;
    const status = row.schedule_status === 'working' ? 'working' : 'day_off';
    const storeId = status === 'working' ? storeIdForName(row.store) : null;
    idx.set(key(employeeName, date), {
      employeeName,
      date,
      status,
      storeId,
      shiftStart: row.shift_start || null,
      shiftEnd: row.shift_end || null,
    });
  }
  return idx;
}

/** Loads the derived t2_april_schedule.csv (employee_name,date,status,store_id,shift_start,shift_end,raw_code). */
export function loadAprilSchedule(csvText: string): ScheduleIndex {
  const idx: ScheduleIndex = new Map();
  for (const row of parseCsv(csvText)) {
    const employeeName = canonicalEmployeeName(row.employee_name);
    const date = row.date;
    if (!date) continue;
    const status = row.status === 'working' ? 'working' : 'day_off';
    idx.set(key(employeeName, date), {
      employeeName,
      date,
      status,
      storeId: status === 'working' ? (row.store_id || null) : null,
      shiftStart: row.shift_start || null,
      shiftEnd: row.shift_end || null,
    });
  }
  return idx;
}

export function mergeScheduleIndexes(...indexes: ScheduleIndex[]): ScheduleIndex {
  const merged: ScheduleIndex = new Map();
  for (const idx of indexes) {
    for (const [k, v] of idx) merged.set(k, v);
  }
  return merged;
}

export function lookupSchedule(idx: ScheduleIndex, employeeName: string, date: string): ScheduleEntry | null {
  return idx.get(key(employeeName, date)) ?? null;
}
