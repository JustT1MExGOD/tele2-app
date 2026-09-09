/**
 * generateDraft orchestration: load inputs (I/O), build the MILP model
 * (domain), solve it (solver adapter), interpret + persist the result.
 * The two-stage solve, prechecks and blocking-error assembly are the exact
 * logic from the pre-split core/schedule/schedule-generator.ts — only the
 * import paths and the injected ScheduleSolver changed (see solve-model.ts).
 */
import { createHash } from 'node:crypto';
import * as employeesRepo from '../../../data/repositories/employees.js';
import * as storesRepo from '../../../data/repositories/stores.js';
import type { StoreRecord } from '../../../data/repositories/stores.js';
import * as schedulesRepo from '../../../data/repositories/schedules.js';
import * as salesRepo from '../../../data/repositories/sales.js';
import * as staffingRepo from '../../../data/repositories/store-staffing.js';
import * as availabilityRepo from '../../../data/repositories/employee-availability.js';
import * as draftsRepo from '../../../data/repositories/schedule-drafts.js';
import { metricKeys } from '../../shared/metrics-catalog.js';
import { weekdayMonday0, monthStart, monthAdd, addDaysIso, defaultTargetMonth, daysInMonth } from '../domain/weekday.js';
import { storeFullShiftHours, deriveShift } from '../domain/shift-time.js';
import { resolveEditableFromDate } from '../domain/editable-boundary.js';
import { buildStaffingResolver, type StaffingResolved } from '../domain/staffing-resolver.js';
import { emptyBucket, addTo, tierAdjustedRate, type HistBuckets, type MetricBucket } from '../domain/history-scoring.js';
import { computeFingerprint, type FingerprintInput } from '../domain/fingerprint.js';
import { runPrechecks, type PrecheckCtx } from '../domain/prechecks.js';
import { buildCandidates, type Candidate, type BuildCtx } from '../domain/candidates.js';
import { runStage1, runStage2Diagnostic } from '../domain/solve-model.js';
import { lpScheduleSolver } from '../solver/lp-solver-adapter.js';
import * as W from '../domain/weights.js';
import { todayMoscow } from '../../../utils/date.js';

async function loadHistoryBuckets(
  orgId: string, targetMonth: string, metrics: string[]
): Promise<{ buckets: HistBuckets; rawSignature: string }> {
  const targetStart = monthStart(targetMonth);
  const buckets: HistBuckets = {
    empStoreWeekday: new Map(), empStore: new Map(), emp: new Map(),
    storeWeekday: new Map(), store: new Map(), org: emptyBucket(metrics)
  };
  const sigParts: string[] = [];
  for (let i = 0; i < W.HIST_WEIGHTS_6.length; i++) {
    const weight = W.HIST_WEIGHTS_6[i];
    const mStart = monthAdd(targetStart, -1 - i);
    const mEnd = monthAdd(mStart, 1);
    const rows = await salesRepo.sumColumnsByEmployeeStoreDateForOrgMonth(orgId, mStart, mEnd, metrics);
    for (const r of rows) {
      const e = String(r.employee_id), s = String(r.store_id), hours = Number(r.hours) || 0;
      const wd = weekdayMonday0(String(r.sale_date));
      addTo(buckets.empStoreWeekday, `${e}|${s}|${wd}`, metrics, weight, hours, r);
      addTo(buckets.empStore, `${e}|${s}`, metrics, weight, hours, r);
      addTo(buckets.emp, e, metrics, weight, hours, r);
      addTo(buckets.storeWeekday, `${s}|${wd}`, metrics, weight, hours, r);
      addTo(buckets.store, s, metrics, weight, hours, r);
      buckets.org.hours += weight * hours;
      for (const m of metrics) buckets.org.metricSum[m] += weight * (Number(r[m]) || 0);
      sigParts.push(`${e}:${s}:${r.sale_date}:${hours}`);
    }
  }
  const rawSignature = createHash('sha256').update(sigParts.sort().join(',')).digest('hex');
  return { buckets, rawSignature };
}

async function loadDayPreferenceScores(
  orgId: string, targetMonth: string,
  employees: { id: number; hire_date: string | null }[]
): Promise<Map<string, number[]>> {
  const targetStart = monthStart(targetMonth);
  const lookbackStart = monthAdd(targetStart, -6);
  const lookbackEnd = targetStart;
  const rows = await schedulesRepo.countShiftsByEmployeeStoreInRange(orgId, lookbackStart, lookbackEnd);
  // countShiftsByEmployeeStoreInRange только группирует по employee+store (не по дате) —
  // для day-off инференса нужны сами даты, поэтому используем findAllRowsForOrgMonth-подобный
  // путь через прямой перебор месяцев с findLockedRowsForOrgMonth (editableFromDate=lookbackEnd
  // означает "весь диапазон считается locked", что здесь и нужно — просто исторические факты).
  const dateRows = await schedulesRepo.findLockedRowsForOrgMonth(orgId, lookbackStart, lookbackEnd, lookbackEnd);
  void rows;

  const byEmployee = new Map<string, string[]>();
  for (const r of dateRows) {
    const e = String(r.employee_id);
    if (!byEmployee.has(e)) byEmployee.set(e, []);
    byEmployee.get(e)!.push(r.work_date);
  }

  const result = new Map<string, number[]>();
  for (const emp of employees) {
    const e = String(emp.id);
    const worked = byEmployee.get(e) || [];
    let boundary = lookbackStart;
    if (emp.hire_date && emp.hire_date > boundary) boundary = emp.hire_date;
    const earliestWorked = worked.length ? worked.reduce((a, b) => (a < b ? a : b)) : null;
    if (earliestWorked && earliestWorked < boundary) boundary = earliestWorked;
    if (boundary < lookbackStart) boundary = lookbackStart;

    const totalDays = Math.max(1, Math.round((Date.parse(lookbackEnd) - Date.parse(boundary)) / 86400000));
    const overallRate = worked.length / totalDays;

    const calendarByWd = new Array(7).fill(0);
    for (let d = boundary; d < lookbackEnd; d = addDaysIso(d, 1)) calendarByWd[weekdayMonday0(d)]++;
    const workedByWd = new Array(7).fill(0);
    for (const d of worked) if (d >= boundary) workedByWd[weekdayMonday0(d)]++;

    const scores = calendarByWd.map((occ, wd) => (occ > 0 ? workedByWd[wd] / occ - overallRate : 0));
    result.set(e, scores);
  }
  return result;
}

type LoadedInputs = Awaited<ReturnType<typeof loadInputs>>;

export async function loadInputs(orgId: string, targetMonth: string) {
  const month = monthStart(targetMonth);
  const monthEnd = monthAdd(month, 1);
  const metrics = await metricKeys();

  const [employeesRaw, storesAll, staffingRows] = await Promise.all([
    employeesRepo.listActiveWithHireDateByOrg(orgId),
    storesRepo.list(orgId),
    staffingRepo.listForOrg(orgId)
  ]);
  const employees = employeesRaw;
  const activeStores = storesAll.filter((s) => s.is_active !== false);

  const editableFromDate = resolveEditableFromDate(month, activeStores);

  const [unavailableRows, scheduleRowsAll, lockedRows] = await Promise.all([
    availabilityRepo.listUnavailableForOrgRange(orgId, month, monthEnd),
    schedulesRepo.findAllRowsForOrgMonth(orgId, month, monthEnd),
    schedulesRepo.findLockedRowsForOrgMonth(orgId, month, monthEnd, editableFromDate)
  ]);

  const { buckets, rawSignature } = await loadHistoryBuckets(orgId, month, metrics);
  const dayPreference = await loadDayPreferenceScores(orgId, month, employees);

  return {
    month, monthEnd, metrics, employees, activeStores, storesAll, staffingRows,
    editableFromDate, unavailableRows, scheduleRowsAll, lockedRows, histBuckets: buckets, historySignature: rawSignature, dayPreference
  };
}

export function buildFingerprintFromLoaded(orgId: string, loaded: LoadedInputs): string {
  return computeFingerprint({
    employees: loaded.employees.map((e) => ({ id: e.id, role: e.role })),
    stores: loaded.storesAll,
    unavailableRows: loaded.unavailableRows.map((r) => ({ employee_id: r.employee_id, kind: r.kind, specific_date: r.specific_date })),
    staffingRows: loaded.staffingRows,
    scheduleRows: loaded.scheduleRowsAll,
    editableFromDate: loaded.editableFromDate,
    historySignature: loaded.historySignature
  });
}

async function loadStoreTargetRates(
  orgId: string, month: string, metrics: string[], activeStores: StoreRecord[],
  resolveStaffing: (storeId: string, dateIso: string) => StaffingResolved | null,
  histBuckets: HistBuckets
): Promise<Map<string, { targetRate: Record<string, number>; participating: string[] }>> {
  const batches = await import('../../../data/repositories/plan-batches.js');
  const { plans } = await batches.storeInputs(orgId, month, monthAdd(month, 1), metrics);
  const out = new Map<string, { targetRate: Record<string, number>; participating: string[] }>();
  for (const store of activeStores) {
    let requiredPersonHours = 0;
    for (const d of daysInMonth(month)) {
      const req = resolveStaffing(store.id, d);
      if (req) requiredPersonHours += req.required * storeFullShiftHours(store, d);
    }
    const planRow = plans.get(store.id);
    const storeBucket = histBuckets.store.get(store.id);
    const targetRate: Record<string, number> = {};
    const participating: string[] = [];
    for (const m of metrics) {
      const planVal = Number(planRow?.[m]) || 0;
      if (planVal > 0 && requiredPersonHours > 0) {
        targetRate[m] = planVal / requiredPersonHours;
        participating.push(m);
      } else if (storeBucket && storeBucket.hours >= W.K_HOURS) {
        targetRate[m] = storeBucket.metricSum[m] / storeBucket.hours;
        if (targetRate[m] > 0) participating.push(m);
      }
    }
    out.set(store.id, { targetRate, participating });
  }
  return out;
}

export type BlockingError = { message: string };

export async function generateDraft(orgId: string, targetMonth: string | undefined, generatedBy: number | null) {
  const month = monthStart(targetMonth || defaultTargetMonth());
  const loaded = await loadInputs(orgId, month);
  const {
    employees, activeStores, staffingRows, editableFromDate, unavailableRows,
    lockedRows, metrics, histBuckets, dayPreference
  } = loaded;

  const resolveStaffing = buildStaffingResolver(staffingRows);
  const editableDates = daysInMonth(month).filter((d) => d >= editableFromDate);

  const blockingErrors: BlockingError[] = [];

  // Конфиг-полнота: каждая активная точка на каждый день месяца (весь месяц, не только editable).
  for (const store of activeStores) {
    for (const d of daysInMonth(month)) {
      if (!resolveStaffing(store.id, d)) {
        blockingErrors.push({ message: `На точке «${store.name}» не настроено требование к персоналу на ${d}.` });
      }
    }
  }

  if (blockingErrors.length) {
    const draft = await draftsRepo.createDraft(
      orgId, month, buildFingerprintFromLoaded(orgId, loaded), blockingErrors,
      'config_error', editableFromDate, generatedBy
    );
    return { draft, items: [] as any[], blocking_errors: blockingErrors };
  }

  // Fixed-past агрегаты (locked rows, work_date < editableFromDate).
  const fixedPastShiftCount = new Map<string, number>();
  const fixedPastHours = new Map<string, number>();
  const fixedPastStoreShifts = new Map<string, number>();
  let fixedPastRegularHours = 0;
  for (const r of lockedRows) {
    const e = String(r.employee_id);
    fixedPastShiftCount.set(e, (fixedPastShiftCount.get(e) || 0) + 1);
    fixedPastHours.set(e, (fixedPastHours.get(e) || 0) + Number(r.hours));
    fixedPastStoreShifts.set(`${e}|${r.store_id}`, (fixedPastStoreShifts.get(`${e}|${r.store_id}`) || 0) + 1);
    if (r.role !== 'trainee') fixedPastRegularHours += Number(r.hours);
  }

  const unavailableByEmpDate = new Set(unavailableRows.map((r) => `${r.employee_id}|${r.specific_date}`));
  const eligible = (empId: string, _storeId: string, dateIso: string) => !unavailableByEmpDate.has(`${empId}|${dateIso}`);

  const maxAvailableShiftHours = (empId: string) => {
    let max = 0;
    for (const store of activeStores) for (const d of editableDates) max = Math.max(max, storeFullShiftHours(store, d));
    void empId;
    return max || 12;
  };

  const precheckErrors = runPrechecks({
    employees: employees.map((e) => ({ id: e.id, role: e.role, full_name: e.full_name })),
    activeStores, editableDates,
    editableEligible: eligible,
    fixedPastShiftCount, fixedPastHours, fixedPastRegularHours, fixedPastStoreShifts,
    resolveStaffing, maxAvailableShiftHours
  });

  if (precheckErrors.length) {
    const errs = precheckErrors.map((message) => ({ message }));
    const draft = await draftsRepo.createDraft(
      orgId, month, buildFingerprintFromLoaded(orgId, loaded), errs,
      'config_error', editableFromDate, generatedBy
    );
    return { draft, items: [] as any[], blocking_errors: errs };
  }

  const targetRates = await loadStoreTargetRates(orgId, month, metrics, activeStores, resolveStaffing, histBuckets);

  const scoreFn = (empId: string, storeId: string, dateIso: string, isTrainee: boolean) => {
    const wd = weekdayMonday0(dateIso);
    const store = activeStores.find((s) => s.id === storeId)!;
    const proposedHours = isTrainee ? W.TRAINEE_SHIFT_HOURS : storeFullShiftHours(store, dateIso);
    const tierInfo = tierAdjustedRate(empId, storeId, wd, metrics, histBuckets);
    const target = targetRates.get(storeId)!;
    let sum = 0, count = 0;
    for (const m of target.participating) {
      const expectedMetric = tierInfo.rate[m] * proposedHours;
      const fullSlotTarget = target.targetRate[m] * storeFullShiftHours(store, dateIso);
      if (fullSlotTarget > 0) { sum += expectedMetric / fullSlotTarget; count++; }
    }
    const score = count > 0 ? sum / count : 0;
    const dp = (dayPreference.get(empId) || [0, 0, 0, 0, 0, 0, 0])[wd];
    return { score, explanation: { tier: tierInfo.tier, historical_hours: Math.round(tierInfo.hoursObserved), dayPreference: dp, fallback_used: tierInfo.tier !== 'employee_store_weekday' } };
  };

  const buildCtx: BuildCtx = {
    employees: employees.map((e) => ({ id: e.id, role: e.role })),
    activeStores, editableDates, eligible, resolveStaffing,
    fixedPastShiftCount, fixedPastHours, fixedPastStoreShifts, scoreFn
  };

  const candidates = buildCandidates(buildCtx);
  let outcome = runStage1(candidates, buildCtx, lpScheduleSolver);

  let solverStatus: draftsRepo.SolverStatus;
  let items: any[] = [];

  if (outcome.status === 'feasible' || outcome.status === 'timeout_feasible') {
    solverStatus = outcome.status;
    items = outcome.assigned;
  } else if (outcome.status === 'solver_error') {
    solverStatus = 'solver_error';
    blockingErrors.push({ message: 'Солвер вернул некорректный результат — попробуйте пересчитать график.' });
  } else {
    const diag = runStage2Diagnostic(candidates, buildCtx, lpScheduleSolver);
    solverStatus = 'infeasible';
    for (const s of diag.shortfalls) {
      const store = activeStores.find((st) => st.id === s.storeId);
      blockingErrors.push({ message: `На «${store?.name || s.storeId}» ${s.date} требуется ${s.required} сотрудника, но доступен только ${s.available}.` });
    }
    if (!diag.shortfalls.length) blockingErrors.push({ message: 'График не может быть построен при текущих ограничениях — проверьте настройки покрытия и доступности.' });
  }

  const fingerprint = buildFingerprintFromLoaded(orgId, loaded);
  const draft = await draftsRepo.createDraft(orgId, month, fingerprint, blockingErrors, solverStatus, editableFromDate, generatedBy);

  if (items.length) {
    await draftsRepo.insertDraftItems(draft.id, items.map((c: Candidate) => ({
      employee_id: Number(c.empId), work_date: c.date, store_id: c.storeId,
      shift_text: c.explanation.shift_text, hours: c.hours,
      predicted_score: c.score, explanation: c.explanation
    })));
  }

  return { draft, items, blocking_errors: blockingErrors };
}

