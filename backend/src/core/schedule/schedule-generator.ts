/**
 * Автоматический генератор месячного графика смен (DRAFT -> APPLY,
 * миграция 0030). Два независимых генератора теперь существуют в
 * проекте — этот и core/plans/employee-plan-generator.ts (распределение
 * персональных ПЛАНОВ ПРОДАЖ по уже существующему графику). Этот модуль
 * решает более сложную задачу: САМ график (кто на какой точке в какой
 * день) — через MILP (javascript-lp-solver), с реальными хард-constraint'ами
 * (потолок смен, обязательный минимум на каждой точке, минимум часов в
 * месяц, поддержка стажёров) и мягкой оптимизацией по исторической
 * продуктивности + инферированным предпочтениям дня недели.
 *
 * Полная формула и обоснование каждого правила — см. план
 * (synthetic-roaming-mountain, финально одобрен). Кратко:
 * 1. weekdayMonday0() — единственная точка, где JS Date вообще трогается
 *    для дня недели (0=Пн..6=Вс, конвенция БД) — Date.getDay() (0=Вс)
 *    нигде в этом файле напрямую не вызывается.
 * 2. editableFromDate — единая ГЛОБАЛЬНАЯ граница редактируемости текущего
 *    месяца: как только хоть одна активная точка сети открылась сегодня —
 *    весь текущий календарный день замораживается целиком (см. план,
 *    round 9 — раздельные по точкам границы намеренно не делаются в v1).
 * 3. Два хардовых правила распределения (replace "0 или ≥5"):
 *    каждый обычный (не стажёр) сотрудник обязан отработать ≥5 смен НА
 *    КАЖДОЙ активной точке сети и набрать ≥179 часов в месяце.
 * 4. Стажёры: ровно 8ч от открытия точки, никогда не считаются в
 *    обязательное покрытие, никогда не работают одни (supervision),
 *    ограничены max_trainees, TRAINEE_ASSIGN_COST не даёт солверу занимать
 *    каждый разрешённый слот стажёра просто потому что это formally EV+.
 * 5. Два прохода солвера: STRICT (хард coverage) -> если infeasible,
 *    DIAGNOSTIC (coverage ослаблена shortfall'ом) только для диагностики,
 *    никогда не применяется.
 */
import * as lpSolverModule from 'javascript-lp-solver';
// Тип d.ts пакета описывает чистый ESM default-export, а фактический CJS
// build делает `module.exports = solver` напрямую — под NodeNext+CJS
// интероп реальная форма импорта на рантайме отличается от заявленного
// типа, поэтому берём any и резолвим оба варианта сами.
const solverLib: { Solve: (model: any, precision?: number, full?: boolean, validate?: boolean) => any } =
  (lpSolverModule as any).default ?? (lpSolverModule as any);
import { createHash } from 'node:crypto';
import * as employeesRepo from '../../data/repositories/employees.js';
import * as storesRepo from '../../data/repositories/stores.js';
import type { StoreRecord } from '../../data/repositories/stores.js';
import * as schedulesRepo from '../../data/repositories/schedules.js';
import * as salesRepo from '../../data/repositories/sales.js';
import * as staffingRepo from '../../data/repositories/store-staffing.js';
import * as availabilityRepo from '../../data/repositories/employee-availability.js';
import * as draftsRepo from '../../data/repositories/schedule-drafts.js';
import { withTransaction } from '../../data/db/index.js';
import { metricKeys } from '../plans/service.js';
import { todayMoscow, nowTimeMoscow } from '../../utils/date.js';
import * as W from './weights.js';

export class StaleDraftError extends Error {
  constructor() {
    super('Черновик устарел: график, точки или настройки покрытия изменились после расчёта — пересчитайте график');
    Object.assign(this, { statusCode: 409 });
    this.name = 'StaleDraftError';
  }
}

export class DraftHasBlockingErrorsError extends Error {
  constructor(public errors: any[]) {
    super('Черновик содержит блокирующие ошибки — применить его нельзя');
    Object.assign(this, { statusCode: 422 });
    this.name = 'DraftHasBlockingErrorsError';
  }
}

// ---------------------------------------------------------------------------
// Дата/день-недели helpers. weekdayMonday0 — ЕДИНСТВЕННОЕ место в этом файле
// (и во всей фиче), где вообще вычисляется день недели даты.
// ---------------------------------------------------------------------------

/** 0=понедельник..6=воскресенье (конвенция БД) — НЕ Date.getDay() (0=воскресенье). */
export function weekdayMonday0(dateIso: string): number {
  const [y, m, d] = dateIso.slice(0, 10).split('-').map(Number);
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sunday..6=Saturday, но НЕ Date.getDay()
  return (jsDay + 6) % 7;
}

function timeToHours(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h + (m || 0) / 60;
}

function hoursToTime(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function addDaysIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function monthStart(month: string): string {
  return month.length === 7 ? `${month}-01` : month.slice(0, 10);
}

export function monthAdd(monthStartIso: string, delta: number): string {
  const [y, m] = monthStart(monthStartIso).split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}

function daysInMonth(startIso: string): string[] {
  const start = monthStart(startIso);
  const end = monthAdd(start, 1);
  const out: string[] = [];
  for (let d = start; d < end; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

/** Текущий месяц (менеджер выбирает текущий/следующий явно во фронте; без выбора — текущий). */
export function defaultTargetMonth(asOf = todayMoscow()): string {
  return monthStart(asOf.slice(0, 7));
}

// ---------------------------------------------------------------------------
// Вывод времени смены — детерминированное бизнес-правило, НЕ решение солвера.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// editableFromDate — единая глобальная граница (см. план, round 9).
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Резолвинг требований покрытия (store_staffing_requirements).
// ---------------------------------------------------------------------------

type StaffingResolved = { required: number; maxTrainees: number };

function buildStaffingResolver(rows: staffingRepo.StaffingRequirementRow[]) {
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

// ---------------------------------------------------------------------------
// Историческая агрегация — почасовая продуктивность, fallback-цепочка +
// shrinkage. Бакеты: employee+store+weekday -> employee+store -> employee
// -> store+weekday -> store -> org.
// ---------------------------------------------------------------------------

type MetricBucket = { metricSum: Record<string, number>; hours: number };
type HistBuckets = {
  empStoreWeekday: Map<string, MetricBucket>;
  empStore: Map<string, MetricBucket>;
  emp: Map<string, MetricBucket>;
  storeWeekday: Map<string, MetricBucket>;
  store: Map<string, MetricBucket>;
  org: MetricBucket;
};

function emptyBucket(metrics: string[]): MetricBucket {
  return { metricSum: Object.fromEntries(metrics.map((m) => [m, 0])), hours: 0 };
}

function addTo(map: Map<string, MetricBucket>, key: string, metrics: string[], weight: number, hours: number, row: any) {
  if (!map.has(key)) map.set(key, emptyBucket(metrics));
  const b = map.get(key)!;
  b.hours += weight * hours;
  for (const m of metrics) b.metricSum[m] += weight * (Number(row[m]) || 0);
}

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

export type TierResult = { rate: Record<string, number>; tier: string; hoursObserved: number };
export type MetricBucketForTest = MetricBucket;
export type HistBucketsForTest = HistBuckets;

/** Fallback-цепочка + shrinkage: adjustedRate = confidence*tierRate + (1-confidence)*nextTierRate. */
export function tierAdjustedRate(empId: string, storeId: string, wd: number, metrics: string[], b: HistBuckets): TierResult {
  const chain: { key: string; map: Map<string, MetricBucket> | null; tier: string }[] = [
    { key: `${empId}|${storeId}|${wd}`, map: b.empStoreWeekday, tier: 'employee_store_weekday' },
    { key: `${empId}|${storeId}`, map: b.empStore, tier: 'employee_store' },
    { key: empId, map: b.emp, tier: 'employee' },
    { key: `${storeId}|${wd}`, map: b.storeWeekday, tier: 'store_weekday' },
    { key: storeId, map: b.store, tier: 'store' }
  ];
  const available = chain
    .map((c) => ({ tier: c.tier, bucket: c.map!.get(c.key) }))
    .filter((c) => c.bucket && c.bucket.hours > 0) as { tier: string; bucket: MetricBucket }[];
  available.push({ tier: 'org', bucket: b.org.hours > 0 ? b.org : ({ metricSum: {}, hours: 0 } as MetricBucket) });

  if (!available.length || available.every((a) => a.bucket.hours <= 0)) {
    return { rate: Object.fromEntries(metrics.map((m) => [m, 0])), tier: 'no_history', hoursObserved: 0 };
  }

  const first = available.find((a) => a.bucket.hours > 0)!;
  const next = available.find((a) => a !== first && a.bucket.hours > 0);
  const confidence = first.bucket.hours / (first.bucket.hours + W.K_HOURS);
  const rate: Record<string, number> = {};
  for (const m of metrics) {
    const firstRate = first.bucket.metricSum[m] / first.bucket.hours;
    const nextRate = next ? next.bucket.metricSum[m] / next.bucket.hours : 0;
    rate[m] = confidence * firstRate + (1 - confidence) * nextRate;
  }
  return { rate, tier: first.tier, hoursObserved: first.bucket.hours };
}

// ---------------------------------------------------------------------------
// День-офф инференс (soft, linear) — per employee×weekday deviation от
// собственного среднего work rate, окно = последние 6 месяцев истории,
// нижняя граница = min(hire_date, самая ранняя реально наблюдаемая смена).
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Fingerprint.
// ---------------------------------------------------------------------------

type FingerprintInput = {
  employees: { id: number; role: string }[];
  stores: StoreRecord[];
  unavailableRows: { employee_id: number; kind: string; specific_date: string | null }[];
  staffingRows: staffingRepo.StaffingRequirementRow[];
  scheduleRows: { employee_id: number; store_id: string; work_date: string; hours: number; shift_text: string }[];
  editableFromDate: string;
  historySignature: string;
};

function computeFingerprint(input: FingerprintInput): string {
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

// ---------------------------------------------------------------------------
// Общая загрузка инпутов — используется и generateDraft, и applyDraft
// (пересчёт fingerprint перед apply должен видеть ТЕ ЖЕ данные).
// ---------------------------------------------------------------------------

type LoadedInputs = Awaited<ReturnType<typeof loadInputs>>;

async function loadInputs(orgId: string, targetMonth: string) {
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

function buildFingerprintFromLoaded(orgId: string, loaded: LoadedInputs): string {
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

// ---------------------------------------------------------------------------
// Продуктивность: store_month_plans (tier1) -> надёжная историческая
// средняя точки (tier2) -> нейтральный 0 (tier3). requiredStorePersonHours
// считается за ВЕСЬ месяц (не только editable) — это знаменатель плана
// точки, план не завязан на то, что именно уже зафиксировано.
// ---------------------------------------------------------------------------

async function loadStoreTargetRates(
  orgId: string, month: string, metrics: string[], activeStores: StoreRecord[],
  resolveStaffing: (storeId: string, dateIso: string) => StaffingResolved | null,
  histBuckets: HistBuckets
): Promise<Map<string, { targetRate: Record<string, number>; participating: string[] }>> {
  const batches = await import('../../data/repositories/plan-batches.js');
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

// ---------------------------------------------------------------------------
// Пре-solve проверки — только математически доказуемо невозможные случаи.
// ---------------------------------------------------------------------------

type PrecheckCtx = {
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

function runPrechecks(ctx: PrecheckCtx): string[] {
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

// ---------------------------------------------------------------------------
// MILP model construction + two-stage solve.
// ---------------------------------------------------------------------------

type Candidate = { empId: string; date: string; storeId: string; isTrainee: boolean; hours: number; score: number; explanation: any };

type BuildCtx = {
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

function buildCandidates(ctx: BuildCtx): Candidate[] {
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

function varName(c: Candidate): string {
  return `x_${c.empId}_${c.date}_${c.storeId}`;
}

type SolveOutcome = {
  status: 'feasible' | 'timeout_feasible' | 'infeasible' | 'solver_error';
  assigned: Candidate[];
  shortfalls: { storeId: string; date: string; required: number; available: number }[];
};

function runStage1(candidates: Candidate[], ctx: BuildCtx): SolveOutcome {
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
    result = solverLib.Solve(model);
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

function runStage2Diagnostic(candidates: Candidate[], ctx: BuildCtx): SolveOutcome {
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
    result = solverLib.Solve(model);
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

// ---------------------------------------------------------------------------
// generateDraft
// ---------------------------------------------------------------------------

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
  let outcome = runStage1(candidates, buildCtx);

  let solverStatus: draftsRepo.SolverStatus;
  let items: any[] = [];

  if (outcome.status === 'feasible' || outcome.status === 'timeout_feasible') {
    solverStatus = outcome.status;
    items = outcome.assigned;
  } else if (outcome.status === 'solver_error') {
    solverStatus = 'solver_error';
    blockingErrors.push({ message: 'Солвер вернул некорректный результат — попробуйте пересчитать график.' });
  } else {
    const diag = runStage2Diagnostic(candidates, buildCtx);
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

export async function viewDraft(draftId: number, orgId: string) {
  const draft = await draftsRepo.findDraftById(draftId, orgId);
  if (!draft) return null;
  const items = await draftsRepo.listDraftItems(draftId);
  return { draft, items };
}

/** APPLY — идемпотентно, блокирует stale/blocking_errors. Locked-строки (work_date <
 * editableFromDate) НИКОГДА не трогаются — ни при подсчёте существующих смен для
 * подтверждения замены, ни при delete/insert. См. план для полного обоснования. */
export async function applyDraft(draftId: number, orgId: string, appliedBy: number | null, replace?: boolean): Promise<any> {
  const draft = await draftsRepo.findDraftById(draftId, orgId);
  if (!draft) throw Object.assign(new Error('Черновик не найден'), { statusCode: 404 });

  if (draft.status === 'applied') return { draft, applied: false };
  if (draft.status === 'stale') throw new StaleDraftError();
  if ((draft.blocking_errors || []).length > 0) throw new DraftHasBlockingErrorsError(draft.blocking_errors);

  const month = String(draft.month).slice(0, 10);
  const loaded = await loadInputs(orgId, month);
  const currentFingerprint = buildFingerprintFromLoaded(orgId, loaded);
  if (currentFingerprint !== draft.input_fingerprint) {
    await draftsRepo.markStale(draft.id);
    throw new StaleDraftError();
  }

  const items = await draftsRepo.listDraftItems(draft.id);
  const editableFromDate = draft.editable_from_date;
  const monthEnd = monthAdd(month, 1);

  const existingEditableCount = await schedulesRepo.countEditableForOrgMonth(orgId, editableFromDate, monthEnd);
  if (existingEditableCount > 0 && !replace) {
    return { draft, applied: false, requires_replace_confirmation: true, existing_editable_shifts: existingEditableCount };
  }

  // Defensive re-check против ЭФФЕКТИВНОГО пост-apply состояния: locked
  // non-trainee строки (переживут apply как есть) + non-trainee draft items
  // (будут вставлены) — НЕ просто "есть ли другой draft item".
  const lockedRegularByStoreDate = new Map<string, number>();
  for (const r of loaded.lockedRows) {
    if (r.role !== 'trainee') {
      const key = `${r.store_id}|${r.work_date}`;
      lockedRegularByStoreDate.set(key, (lockedRegularByStoreDate.get(key) || 0) + 1);
    }
  }
  const empRoleById = new Map(loaded.employees.map((e) => [e.id, e.role]));
  const insertedRegularByStoreDate = new Map<string, number>();
  for (const it of items) {
    if (empRoleById.get(it.employee_id) !== 'trainee') {
      const key = `${it.store_id}|${it.work_date}`;
      insertedRegularByStoreDate.set(key, (insertedRegularByStoreDate.get(key) || 0) + 1);
    }
  }
  for (const it of items) {
    if (empRoleById.get(it.employee_id) !== 'trainee') continue;
    const key = `${it.store_id}|${it.work_date}`;
    const effective = (insertedRegularByStoreDate.get(key) || 0); // locked non-trainee rows never exist here (editable range wholesale replaced)
    if (effective < 1) {
      throw new DraftHasBlockingErrorsError([
        { message: `Стажёр ${it.employee_id} не может работать на точке ${it.store_id} ${it.work_date} без основного сотрудника.` }
      ]);
    }
  }
  void lockedRegularByStoreDate;

  return withTransaction(async () => {
    const locked = await draftsRepo.findDraftForUpdate(draftId, orgId);
    if (!locked) throw Object.assign(new Error('Черновик не найден'), { statusCode: 404 });
    if (locked.status === 'applied') return { draft: locked, applied: false };
    if (locked.status === 'stale') throw new StaleDraftError();

    // Повторная проверка locked-строк под транзакцией — если кто-то вручную
    // поправил уже зафиксированную сегодняшнюю смену прямо в этот момент.
    const recheckLocked = await schedulesRepo.findLockedRowsForOrgMonth(orgId, month, monthEnd, editableFromDate);
    const lockedSignature = recheckLocked.map((r) => `${r.employee_id}:${r.store_id}:${r.work_date}:${r.hours}:${r.shift_text}`).sort().join(',');
    const originalLockedSignature = loaded.lockedRows.map((r) => `${r.employee_id}:${r.store_id}:${r.work_date}:${r.hours}:${r.shift_text}`).sort().join(',');
    if (lockedSignature !== originalLockedSignature) throw new StaleDraftError();

    await schedulesRepo.deleteEditableRangeForOrgMonth(orgId, editableFromDate, monthEnd);
    for (const it of items) {
      await schedulesRepo.upsert(it.employee_id, it.store_id, it.work_date, it.shift_text, it.hours);
    }

    await draftsRepo.markApplied(locked.id, appliedBy, replace ? 'replace' : null);
    const applied = await draftsRepo.findDraftById(locked.id, orgId);
    return { draft: applied!, applied: true };
  });
}
