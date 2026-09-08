/**
 * Резолвинг требований покрытия (store_staffing_requirements): override по
 * конкретной дате побеждает weekday-дефолт (см. план synthetic-roaming-mountain).
 */
import * as staffingRepo from '../../../data/repositories/store-staffing.js';
import { weekdayMonday0 } from './weekday.js';

export type StaffingResolved = { required: number; maxTrainees: number };

export function buildStaffingResolver(rows: staffingRepo.StaffingRequirementRow[]) {
  const byDate = new Map<string, StaffingResolved>();
  const byWeekday = new Map<string, StaffingResolved>();
  for (const r of rows) {
    const v: StaffingResolved = { required: r.required_employees, maxTrainees: r.max_trainees };
    if (r.specific_date) byDate.set(`${r.store_id}|${r.specific_date.slice(0, 10)}`, v);
    else if (r.weekday != null) byWeekday.set(`${r.store_id}|${r.weekday}`, v);
  }
  return (storeId: string, dateIso: string): StaffingResolved | null => {
    const dk = `${storeId}|${dateIso}`;
    if (byDate.has(dk)) return byDate.get(dk)!;
    const wd = weekdayMonday0(dateIso);
    return byWeekday.get(`${storeId}|${wd}`) || null;
  };
}

