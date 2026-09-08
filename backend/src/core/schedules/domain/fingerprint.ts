/**
 * Fingerprint черновика графика — sha256 по всем входам, которые solve
 * учитывает; пересчитывается идентично перед apply (staleness-check).
 */
import { createHash } from 'node:crypto';
import type { StoreRecord } from '../../../data/repositories/stores.js';
import type * as staffingRepo from '../../../data/repositories/store-staffing.js';

export type FingerprintInput = {
  employees: { id: number; role: string }[];
  stores: StoreRecord[];
  unavailableRows: { employee_id: number; kind: string; specific_date: string | null }[];
  staffingRows: staffingRepo.StaffingRequirementRow[];
  scheduleRows: { employee_id: number; store_id: string; work_date: string; hours: number; shift_text: string }[];
  editableFromDate: string;
  historySignature: string;
};

export function computeFingerprint(input: FingerprintInput): string {
  const empPart = input.employees.map((e) => `${e.id}:${e.role}`).sort().join(',');
  const storePart = input.stores
    .map((s) => `${s.id}:${s.is_active}:${s.open_time_weekday}:${s.open_time_sunday || ''}:${s.close_time_weekday}:${s.close_time_sunday || ''}`)
    .sort().join(',');
  const unavailPart = input.unavailableRows.map((r) => `${r.employee_id}:${r.kind}:${r.specific_date}`).sort().join(',');
  const staffPart = input.staffingRows
    .map((r) => `${r.store_id}:${r.weekday ?? ''}:${r.specific_date ?? ''}:${r.required_employees}:${r.max_trainees}`)
    .sort().join(',');
  const schedPart = input.scheduleRows.map((r) => `${r.employee_id}:${r.store_id}:${r.work_date}:${r.hours}:${r.shift_text}`).sort().join(',');
  return createHash('sha256')
    .update([empPart, storePart, unavailPart, staffPart, schedPart, input.editableFromDate, input.historySignature].join('|'))
    .digest('hex');
}

