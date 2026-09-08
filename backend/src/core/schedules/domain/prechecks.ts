/**
 * Пре-solve проверки — только математически доказуемо невозможные случаи
 * (см. план synthetic-roaming-mountain). Не заменяют solver, только дешёвый
 * ранний выход для однозначных случаев.
 */
import type { StoreRecord } from '../../../data/repositories/stores.js';
import * as W from './weights.js';
import { storeFullShiftHours } from './shift-time.js';

type StaffingResolved = { required: number; maxTrainees: number };

export type PrecheckCtx = {
  employees: { id: number; role: string; full_name: string }[];
  activeStores: StoreRecord[];
  editableDates: string[];
  editableEligible: (empId: string, storeId: string, dateIso: string) => boolean;
  fixedPastShiftCount: Map<string, number>;
  fixedPastHours: Map<string, number>;
  fixedPastRegularHours: number;
  fixedPastStoreShifts: Map<string, number>; // key emp|store
  resolveStaffing: (storeId: string, dateIso: string) => StaffingResolved | null;
  maxAvailableShiftHours: (empId: string) => number;
};

export function runPrechecks(ctx: PrecheckCtx): string[] {
  const errors: string[] = [];
  const regulars = ctx.employees.filter((e) => e.role !== 'trainee');

  for (const emp of regulars) {
    const past = ctx.fixedPastShiftCount.get(String(emp.id)) || 0;
    if (past > W.MAX_SHIFTS_PER_MONTH) {
      errors.push(`У сотрудника «${emp.full_name}» уже ${past} зафиксированных смен в этом месяце — это больше разрешённого максимума ${W.MAX_SHIFTS_PER_MONTH}.`);
    }
  }

  const activeStoreCount = ctx.activeStores.length;
  if (activeStoreCount * W.MIN_SHIFTS_PER_STORE > W.MAX_SHIFTS_PER_MONTH) {
    errors.push(`При ${activeStoreCount} активных точках обязательный минимум ${W.MIN_SHIFTS_PER_STORE} смен на точку и потолок ${W.MAX_SHIFTS_PER_MONTH} смен несовместимы.`);
    return errors; // дальше считать бессмысленно — базовая структура уже сломана
  }

  let requiredRegularHours = ctx.fixedPastRegularHours;
  for (const store of ctx.activeStores) {
    for (const d of ctx.editableDates) {
      const req = ctx.resolveStaffing(store.id, d);
      if (req) requiredRegularHours += req.required * storeFullShiftHours(store, d);
    }
  }
  const minimumRegularHours = regulars.length * W.MONTHLY_HOURS_MIN;
  if (requiredRegularHours < minimumRegularHours) {
    errors.push(`По настройкам покрытия в месяце доступно только ${Math.round(requiredRegularHours)} рабочих часов, но для ${regulars.length} сотрудников требуется минимум ${minimumRegularHours} часов.`);
  }

  for (const emp of regulars) {
    const eKey = String(emp.id);
    for (const store of ctx.activeStores) {
      const already = ctx.fixedPastStoreShifts.get(`${eKey}|${store.id}`) || 0;
      const needed = Math.max(0, W.MIN_SHIFTS_PER_STORE - already);
      if (needed <= 0) continue;
      const remaining = ctx.editableDates.filter((d) => ctx.editableEligible(eKey, store.id, d)).length;
      if (remaining < needed) {
        errors.push(`«${emp.full_name}» не может набрать ${W.MIN_SHIFTS_PER_STORE} смен на точке «${store.name}» в этом месяце.`);
      }
    }
  }

  for (const emp of regulars) {
    const eKey = String(emp.id);
    const past = ctx.fixedPastShiftCount.get(eKey) || 0;
    const pastHours = ctx.fixedPastHours.get(eKey) || 0;
    const remainingSlots = W.MAX_SHIFTS_PER_MONTH - past;
    const maxPossible = pastHours + Math.max(0, remainingSlots) * ctx.maxAvailableShiftHours(eKey);
    if (maxPossible < W.MONTHLY_HOURS_MIN) {
      errors.push(`«${emp.full_name}» не может набрать ${W.MONTHLY_HOURS_MIN}ч в этом месяце при оставшихся сменах.`);
    }
  }

  for (const store of ctx.activeStores) {
    let neededTotal = 0;
    for (const emp of regulars) {
      const already = ctx.fixedPastStoreShifts.get(`${emp.id}|${store.id}`) || 0;
      neededTotal += Math.max(0, W.MIN_SHIFTS_PER_STORE - already);
    }
    let availableSlots = 0;
    for (const d of ctx.editableDates) {
      const req = ctx.resolveStaffing(store.id, d);
      if (req) availableSlots += req.required;
    }
    if (neededTotal > availableSlots) {
      errors.push(`На точке «${store.name}» недостаточно смен, чтобы дать каждому сотруднику минимум ${W.MIN_SHIFTS_PER_STORE}.`);
    }
  }

  return errors;
}

