/**
 * MILP model construction + two-stage solve orchestration. Builds the model
 * as plain data (LpModel) and interprets the raw result — the concrete
 * javascript-lp-solver call is injected via the ScheduleSolver contract
 * (corr. #4), so this file never imports the library itself.
 */
import type { Candidate, BuildCtx } from './candidates.js';
import { varName } from './candidates.js';
import type { ScheduleSolver } from '../solver/contract.js';
import * as W from './weights.js';

export type SolveOutcome = {
  status: 'feasible' | 'timeout_feasible' | 'infeasible' | 'solver_error';
  assigned: Candidate[];
  shortfalls: { storeId: string; date: string; required: number; available: number }[];
};

export function runStage1(candidates: Candidate[], ctx: BuildCtx, solver: ScheduleSolver): SolveOutcome {
  const model: any = {
    optimize: 'obj', opType: 'max',
    constraints: {} as Record<string, any>,
    variables: {} as Record<string, any>,
    binaries: {} as Record<string, 1>,
    timeout: W.SOLVER_TIMEOUT_MS
  };

  const regularKeys = ctx.employees.filter((e) => e.role !== 'trainee').map((e) => String(e.id));
  const traineeKeys = ctx.employees.filter((e) => e.role === 'trainee').map((e) => String(e.id));

  for (const eKey of ctx.employees.map((e) => String(e.id))) {
    const past = ctx.fixedPastShiftCount.get(eKey) || 0;
    model.constraints[`cap_${eKey}`] = { max: Math.max(0, W.MAX_SHIFTS_PER_MONTH - past) };
  }
  for (const eKey of regularKeys) {
    const pastHours = ctx.fixedPastHours.get(eKey) || 0;
    model.constraints[`hmin_${eKey}`] = { min: W.MONTHLY_HOURS_MIN - pastHours };
    model.constraints[`exh_${eKey}`] = { max: W.MONTHLY_HOURS_MIN - pastHours };
    model.variables[`excess_${eKey}`] = { obj: -W.EXCESS_HOURS_WEIGHT, [`exh_${eKey}`]: -1 };
    for (const store of ctx.activeStores) {
      const already = ctx.fixedPastStoreShifts.get(`${eKey}|${store.id}`) || 0;
      model.constraints[`storemin_${eKey}_${store.id}`] = { min: Math.max(0, W.MIN_SHIFTS_PER_STORE - already) };
    }
  }
  for (const store of ctx.activeStores) {
    for (const d of ctx.editableDates) {
      const req = ctx.resolveStaffing(store.id, d);
      if (!req) continue;
      model.constraints[`cov_${store.id}_${d}`] = { equal: req.required };
      model.constraints[`tcap_${store.id}_${d}`] = { max: req.maxTrainees };
    }
  }
  for (const eKey of ctx.employees.map((e) => String(e.id))) {
    for (const d of ctx.editableDates) model.constraints[`one_${eKey}_${d}`] = { max: 1 };
  }

  for (const c of candidates) {
    const name = varName(c);
    const coeffs: Record<string, number> = {
      obj: c.score * W.PRODUCTIVITY_WEIGHT + (c.explanation.dayPreference || 0) * W.DAY_PREFERENCE_WEIGHT - (c.isTrainee ? W.TRAINEE_ASSIGN_COST : 0),
      [`cap_${c.empId}`]: 1,
      [`one_${c.empId}_${c.date}`]: 1
    };
    if (!c.isTrainee) {
      coeffs[`hmin_${c.empId}`] = c.hours;
      coeffs[`exh_${c.empId}`] = c.hours;
      coeffs[`storemin_${c.empId}_${c.storeId}`] = 1;
      if (model.constraints[`cov_${c.storeId}_${c.date}`]) coeffs[`cov_${c.storeId}_${c.date}`] = 1;
    } else {
      if (model.constraints[`tcap_${c.storeId}_${c.date}`]) coeffs[`tcap_${c.storeId}_${c.date}`] = 1;
    }
    model.variables[name] = coeffs;
    model.binaries[name] = 1;
  }

  // Supervision: x[trainee] <= Σ non-trainee, только для (store,date) где реально есть и стажёр, и требование.
  if (traineeKeys.length) {
    const byStoreDate = new Map<string, { trainees: Candidate[]; regulars: Candidate[] }>();
    for (const c of candidates) {
      const key = `${c.storeId}|${c.date}`;
      if (!byStoreDate.has(key)) byStoreDate.set(key, { trainees: [], regulars: [] });
      (c.isTrainee ? byStoreDate.get(key)!.trainees : byStoreDate.get(key)!.regulars).push(c);
    }
    for (const [key, group] of byStoreDate) {
      if (!group.trainees.length) continue;
      for (const t of group.trainees) {
        const consName = `sup_${varName(t)}`;
        model.constraints[consName] = { max: 0 };
        model.variables[varName(t)][consName] = 1;
        for (const r of group.regulars) {
          model.variables[varName(r)][consName] = (model.variables[varName(r)][consName] || 0) - 1;
        }
      }
      void key;
    }
  }

  const started = Date.now();
  let result: any;
  try {
    result = solver.solve(model);
  } catch {
    return { status: 'solver_error', assigned: [], shortfalls: [] };
  }
  const elapsed = Date.now() - started;

  if (!result || result.feasible !== true) return { status: 'infeasible', assigned: [], shortfalls: [] };
  if (result.bounded === false || result.isIntegral === false) return { status: 'solver_error', assigned: [], shortfalls: [] };

  const assigned = candidates.filter((c) => Math.round(Number(result[varName(c)]) || 0) === 1);
  const status: 'feasible' | 'timeout_feasible' = elapsed >= W.SOLVER_TIMEOUT_MS ? 'timeout_feasible' : 'feasible';
  return { status, assigned, shortfalls: [] };
}

export function runStage2Diagnostic(candidates: Candidate[], ctx: BuildCtx, solver: ScheduleSolver): SolveOutcome {
  const model: any = {
    optimize: 'obj', opType: 'min',
    constraints: {} as Record<string, any>,
    variables: {} as Record<string, any>,
    binaries: {} as Record<string, 1>,
    timeout: W.SOLVER_TIMEOUT_MS
  };

  const regularKeys = ctx.employees.filter((e) => e.role !== 'trainee').map((e) => String(e.id));
  const traineeKeys = ctx.employees.filter((e) => e.role === 'trainee').map((e) => String(e.id));

  for (const eKey of ctx.employees.map((e) => String(e.id))) {
    const past = ctx.fixedPastShiftCount.get(eKey) || 0;
    model.constraints[`cap_${eKey}`] = { max: Math.max(0, W.MAX_SHIFTS_PER_MONTH - past) };
  }
  for (const eKey of regularKeys) {
    const pastHours = ctx.fixedPastHours.get(eKey) || 0;
    model.constraints[`hmin_${eKey}`] = { min: W.MONTHLY_HOURS_MIN - pastHours };
    for (const store of ctx.activeStores) {
      const already = ctx.fixedPastStoreShifts.get(`${eKey}|${store.id}`) || 0;
      model.constraints[`storemin_${eKey}_${store.id}`] = { min: Math.max(0, W.MIN_SHIFTS_PER_STORE - already) };
    }
  }
  const reqByStoreDate = new Map<string, number>();
  for (const store of ctx.activeStores) {
    for (const d of ctx.editableDates) {
      const req = ctx.resolveStaffing(store.id, d);
      if (!req) continue;
      model.constraints[`cov_${store.id}_${d}`] = { min: req.required };
      model.constraints[`tcap_${store.id}_${d}`] = { max: req.maxTrainees };
      reqByStoreDate.set(`${store.id}|${d}`, req.required);
      model.variables[`short_${store.id}_${d}`] = { obj: 1, [`cov_${store.id}_${d}`]: 1 };
    }
  }
  for (const eKey of ctx.employees.map((e) => String(e.id))) {
    for (const d of ctx.editableDates) model.constraints[`one_${eKey}_${d}`] = { max: 1 };
  }

  for (const c of candidates) {
    const name = varName(c);
    const coeffs: Record<string, number> = { obj: 0, [`cap_${c.empId}`]: 1, [`one_${c.empId}_${c.date}`]: 1 };
    if (!c.isTrainee) {
      coeffs[`hmin_${c.empId}`] = c.hours;
      coeffs[`storemin_${c.empId}_${c.storeId}`] = 1;
      if (model.constraints[`cov_${c.storeId}_${c.date}`]) coeffs[`cov_${c.storeId}_${c.date}`] = 1;
    } else {
      if (model.constraints[`tcap_${c.storeId}_${c.date}`]) coeffs[`tcap_${c.storeId}_${c.date}`] = 1;
    }
    model.variables[name] = coeffs;
    model.binaries[name] = 1;
  }

  if (traineeKeys.length) {
    const byStoreDate = new Map<string, { trainees: Candidate[]; regulars: Candidate[] }>();
    for (const c of candidates) {
      const key = `${c.storeId}|${c.date}`;
      if (!byStoreDate.has(key)) byStoreDate.set(key, { trainees: [], regulars: [] });
      (c.isTrainee ? byStoreDate.get(key)!.trainees : byStoreDate.get(key)!.regulars).push(c);
    }
    for (const group of byStoreDate.values()) {
      if (!group.trainees.length) continue;
      for (const t of group.trainees) {
        const consName = `sup_${varName(t)}`;
        model.constraints[consName] = { max: 0 };
        model.variables[varName(t)][consName] = 1;
        for (const r of group.regulars) model.variables[varName(r)][consName] = (model.variables[varName(r)][consName] || 0) - 1;
      }
    }
  }

  let result: any;
  try {
    result = solver.solve(model);
  } catch {
    return { status: 'solver_error', assigned: [], shortfalls: [] };
  }
  if (!result || result.feasible !== true) return { status: 'solver_error', assigned: [], shortfalls: [] };

  const shortfalls: { storeId: string; date: string; required: number; available: number }[] = [];
  for (const [key, required] of reqByStoreDate) {
    const [storeId, date] = key.split('|');
    const shortfall = Math.round(Number(result[`short_${storeId}_${date}`]) || 0);
    if (shortfall > 0) shortfalls.push({ storeId, date, required, available: required - shortfall });
  }
  return { status: 'infeasible', assigned: [], shortfalls };
}

