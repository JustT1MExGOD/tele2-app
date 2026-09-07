import { parseCsv } from './csv.js';
import { canonicalEmployeeName } from './employees.js';
import { storeIdForName } from './stores.js';

export interface SchedulePlanRow {
  employeeName: string;
  date: string;
  status: 'working' | 'day_off';
  storeId: string | null;
  shiftText: string | null;
  hours: number;
}

/** 09:00–21:00 = 12h, 10:00–21:00 = 11h (confirmed pattern across both source files); day_off = 0h. */
function hoursFor(start: string, end: string): number {
  if (start === '09:00' && end === '21:00') return 12;
  if (start === '10:00' && end === '21:00') return 11;
  return 0;
}

export function loadMayJulSchedulePlan(csvText: string): SchedulePlanRow[] {
  const rows: SchedulePlanRow[] = [];
  for (const row of parseCsv(csvText)) {
    if (row.record_type !== 'schedule') continue;
    const employeeName = canonicalEmployeeName(row.employee_name);
    const date = row.date;
    if (!date) continue;
    const status = row.schedule_status === 'working' ? 'working' : 'day_off';
    const storeId = status === 'working' ? storeIdForName(row.store) : null;
    rows.push({
      employeeName,
      date,
      status,
      storeId,
      shiftText: row.schedule_code_normalized || null,
      hours: status === 'working' ? hoursFor(row.shift_start, row.shift_end) : 0,
    });
  }
  return rows;
}

export function loadAprilSchedulePlan(csvText: string): SchedulePlanRow[] {
  const rows: SchedulePlanRow[] = [];
  for (const row of parseCsv(csvText)) {
    const employeeName = canonicalEmployeeName(row.employee_name);
    const date = row.date;
    if (!date) continue;
    const status = row.status === 'working' ? 'working' : 'day_off';
    rows.push({
      employeeName,
      date,
      status,
      storeId: status === 'working' ? (row.store_id || null) : null,
      shiftText: row.raw_code || null,
      hours: status === 'working' ? hoursFor(row.shift_start, row.shift_end) : 0,
    });
  }
  return rows;
}
