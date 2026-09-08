/**
 * Кандидаты MILP-переменных x[employee,date,store] — генерация и именование
 * переменных. Чистая функция от уже посчитанного scoreFn/eligible/resolveStaffing
 * (сами эти функции строятся в application/generate-draft.ts из загруженных данных).
 */
import type { StoreRecord } from '../../../data/repositories/stores.js';
import { deriveShift } from './shift-time.js';

type StaffingResolved = { required: number; maxTrainees: number };

export type Candidate = { empId: string; date: string; storeId: string; isTrainee: boolean; hours: number; score: number; explanation: any };

export type BuildCtx = {
  employees: { id: number; role: string }[];
  activeStores: StoreRecord[];
  editableDates: string[];
  eligible: (empId: string, storeId: string, dateIso: string) => boolean;
  resolveStaffing: (storeId: string, dateIso: string) => StaffingResolved | null;
  fixedPastShiftCount: Map<string, number>;
  fixedPastHours: Map<string, number>;
  fixedPastStoreShifts: Map<string, number>;
  scoreFn: (empId: string, storeId: string, dateIso: string, isTrainee: boolean) => { score: number; explanation: any };
};

export function buildCandidates(ctx: BuildCtx): Candidate[] {
  const candidates: Candidate[] = [];
  for (const emp of ctx.employees) {
    const eKey = String(emp.id);
    const isTrainee = emp.role === 'trainee';
    for (const d of ctx.editableDates) {
      for (const store of ctx.activeStores) {
        if (!ctx.eligible(eKey, store.id, d)) continue;
        const { shift_text, hours } = deriveShift(store, d, isTrainee);
        const { score, explanation } = ctx.scoreFn(eKey, store.id, d, isTrainee);
        candidates.push({ empId: eKey, date: d, storeId: store.id, isTrainee, hours, score, explanation: { ...explanation, shift_text } });
      }
    }
  }
  return candidates;
}

export function varName(c: Candidate): string {
  return `x_${c.empId}_${c.date}_${c.storeId}`;
}

