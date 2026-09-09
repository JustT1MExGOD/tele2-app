/**
 * generateDraft/viewDraft/applyDraft for employee-plan-generator — the
 * capability inside `plans` that recommends next-month personal targets
 * (DRAFT -> APPLY, migration 0029). Moved verbatim from
 * core/plans/employee-plan-generator.ts (20.58.0 split) — only import
 * paths changed, plus loadMonthAgg moved here unchanged (it's I/O).
 */
import * as employeesRepo from '../../../data/repositories/employees.js';
import * as storesRepo from '../../../data/repositories/stores.js';
import * as schedulesRepo from '../../../data/repositories/schedules.js';
import * as salesRepo from '../../../data/repositories/sales.js';
import * as plansRepo from '../../../data/repositories/plans.js';
import * as batches from '../../../data/repositories/plan-batches.js';
import * as draftsRepo from '../../../data/repositories/employee-plan-drafts.js';
import { withTransaction } from '../../../data/db/index.js';
import { getMetricDefs } from '../../shared/metrics-catalog.js';
import { metricKeys } from '../ports/read-model.js';
import { createHash } from 'node:crypto';
import { StaleDraftError, DraftHasBlockingErrorsError } from './errors.js';
import { monthStart, monthAdd, todayMoscow, defaultTargetMonth } from '../scoring/date-helpers.js';
import { HIST_WEIGHTS, historicalMonths, historicalMonthsForTarget, weightedProductivity, largestRemainderRound, type MonthAgg, type ProductivityResult } from '../scoring/productivity.js';

async function loadMonthAgg(orgId: string, month: string, weight: number, metrics: string[]): Promise<MonthAgg> {
  const start = monthStart(month);
  const end = monthAdd(start, 1);
  const [shiftRows, salesRows] = await Promise.all([
    schedulesRepo.countShiftsByEmployeeStoreInRange(orgId, start, end),
    salesRepo.sumColumnsByEmployeeStoreForOrgMonth(orgId, start, end, metrics)
  ]);

  const empStoreShifts = new Map<string, Map<string, number>>();
  const storeShifts = new Map<string, number>();
  let orgShifts = 0;
  for (const r of shiftRows) {
    const e = String(r.employee_id), s = String(r.store_id), n = Number(r.shifts) || 0;
    if (!empStoreShifts.has(e)) empStoreShifts.set(e, new Map());
    empStoreShifts.get(e)!.set(s, n);
    storeShifts.set(s, (storeShifts.get(s) || 0) + n);
    orgShifts += n;
  }

  const empStoreSales = new Map<string, Map<string, Record<string, number>>>();
  const storeSales = new Map<string, Record<string, number>>();
  const orgSales: Record<string, number> = {};
  for (const m of metrics) orgSales[m] = 0;
  for (const r of salesRows) {
    const e = String(r.employee_id), s = String(r.store_id);
    const vals: Record<string, number> = {};
    for (const m of metrics) vals[m] = Number((r as any)[m]) || 0;
    if (!empStoreSales.has(e)) empStoreSales.set(e, new Map());
    empStoreSales.get(e)!.set(s, vals);
    const acc = storeSales.get(s) || Object.fromEntries(metrics.map((m) => [m, 0]));
    for (const m of metrics) { acc[m] += vals[m]; orgSales[m] += vals[m]; }
    storeSales.set(s, acc);
  }

  return { month: start, weight, empStoreShifts, empStoreSales, storeShifts, storeSales, orgShifts, orgSales };
}

export type BlockingError = { store_id: string; store_name: string; message: string };

export type StoreBreakdown = {
  store_id: string;
  store_name: string;
  future_shifts: number;
  tier: 'employee_store' | 'store_avg' | 'org_avg' | 'no_history';
  historical_months: { month: string; shifts: number; weight: number }[];
  productivity: Record<string, number>;
  raw_contribution: Record<string, number>;
  normalized_share: Record<string, number>;
  metric_fallback: Record<string, 'proportional_shifts'>;
  final_plan: Record<string, number>;
};

export type EmployeeDraftItem = {
  employee_id: number;
  full_name: string;
  total_shifts: number;
  by_store: StoreBreakdown[];
  final_plan: Record<string, number>;
  warnings: string[];
};

export type GenerateDraftResult = {
  draft: draftsRepo.DraftRow;
  items: EmployeeDraftItem[];
  blocking_errors: BlockingError[];
};

export function computeFingerprint(
  futureShiftRows: { employee_id: number; store_id: string; shifts: number }[],
  storePlans: Map<string, any>
): string {
  const shiftsPart = futureShiftRows
    .map((r) => `${r.employee_id}:${r.store_id}:${r.shifts}`)
    .sort()
    .join(',');
  const plansPart = [...storePlans.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([storeId, row]) => `${storeId}:${JSON.stringify(row)}`)
    .join(',');
  return createHash('sha256').update(shiftsPart + '|' + plansPart).digest('hex');
}

export async function loadDraftInputs(orgId: string, targetMonth: string, metrics: string[]) {
  const start = monthStart(targetMonth);
  const end = monthAdd(start, 1);
  const [employees, stores, futureShiftRows, storeInput] = await Promise.all([
    employeesRepo.listActiveByOrg(orgId, false),
    storesRepo.listActiveBasic(orgId),
    schedulesRepo.countShiftsByEmployeeStoreInRange(orgId, start, end),
    batches.storeInputs(orgId, start, end, metrics)
  ]);
  return { employees, stores, futureShiftRows, storePlans: storeInput.plans, start };
}

export async function generateDraft(orgId: string, targetMonth: string | undefined, generatedBy: number | null): Promise<GenerateDraftResult> {
  const metrics = await metricKeys();
  const metricDefs = await getMetricDefs();
  const unitOf = new Map(metricDefs.map((d) => [d.id, d.unit]));
  // explicitTarget: месяц выбран менеджером вручную (UI прислал month) — история
  // считается строго относительно ЭТОГО месяца (target-1,-2,-3). Если month не
  // передан вовсе — старое поведение "план на следующий месяц" с историей
  // относительно СЕГОДНЯШНЕЙ даты (пропускает текущий незавершённый месяц),
  // не меняется, backward compatibility.
  const explicitTarget = !!targetMonth;
  const month = monthStart(targetMonth || defaultTargetMonth());

  const { employees, stores, futureShiftRows, storePlans } = await loadDraftInputs(orgId, month, metrics);

  const monthsMeta = explicitTarget ? historicalMonthsForTarget(month) : historicalMonths();
  const histAggs = await Promise.all(monthsMeta.map((m) => loadMonthAgg(orgId, m.month, m.weight, metrics)));

  const futureByEmployeeStore = new Map<string, Map<string, number>>();
  const futureByStore = new Map<string, number>();
  for (const r of futureShiftRows) {
    const e = String(r.employee_id), s = String(r.store_id), n = Number(r.shifts) || 0;
    if (!futureByEmployeeStore.has(e)) futureByEmployeeStore.set(e, new Map());
    futureByEmployeeStore.get(e)!.set(s, n);
    futureByStore.set(s, (futureByStore.get(s) || 0) + n);
  }

  // Блокирующая валидация: план точки > 0 по любой метрике, но 0 будущих смен.
  const blockingErrors: BlockingError[] = [];
  for (const st of stores) {
    const planRow = storePlans.get(st.id);
    if (!planRow) continue;
    const hasPositivePlan = metrics.some((m) => Number(planRow[m]) > 0);
    if (hasPositivePlan && !(futureByStore.get(st.id) > 0)) {
      blockingErrors.push({
        store_id: st.id, store_name: st.name,
        message: `У точки «${st.name}» есть план на ${month.slice(0, 7)}, но на этот месяц не запланировано ни одной смены`
      });
    }
  }

  const storeById = new Map(stores.map((s) => [s.id, s]));

  // Сырые (до нормализации) вклады по каждой (точка, метрика): store_id -> metric -> [{employee_id, value}]
  const rawByStoreMetric = new Map<string, Map<string, { employee_id: string; value: number }[]>>();
  const itemsByEmployee = new Map<string, EmployeeDraftItem>();

  for (const emp of employees) {
    const empId = String(emp.id);
    const empStores = futureByEmployeeStore.get(empId);
    if (!empStores || empStores.size === 0) continue;

    let totalShifts = 0;
    const byStore: StoreBreakdown[] = [];

    for (const [storeId, futureShifts] of empStores) {
      if (futureShifts <= 0) continue;
      const st = storeById.get(storeId);
      if (!st) continue; // точка неактивна/чужой сети — пропускаем
      totalShifts += futureShifts;

      let tier: StoreBreakdown['tier'];
      let result: ProductivityResult | null;

      result = weightedProductivity(histAggs, metrics,
        (a) => a.empStoreShifts.get(empId)?.get(storeId) || 0,
        (a) => a.empStoreSales.get(empId)?.get(storeId));
      if (result) {
        tier = 'employee_store';
      } else {
        result = weightedProductivity(histAggs, metrics,
          (a) => a.storeShifts.get(storeId) || 0,
          (a) => a.storeSales.get(storeId));
        if (result) {
          tier = 'store_avg';
        } else {
          result = weightedProductivity(histAggs, metrics, (a) => a.orgShifts, (a) => a.orgSales);
          tier = result ? 'org_avg' : 'no_history';
        }
      }

      const productivity = result?.productivity || Object.fromEntries(metrics.map((m) => [m, 0]));
      const rawContribution: Record<string, number> = {};
      for (const m of metrics) rawContribution[m] = futureShifts * (productivity[m] || 0);

      for (const m of metrics) {
        if (!rawByStoreMetric.has(storeId)) rawByStoreMetric.set(storeId, new Map());
        const byMetric = rawByStoreMetric.get(storeId)!;
        if (!byMetric.has(m)) byMetric.set(m, []);
        byMetric.get(m)!.push({ employee_id: empId, value: rawContribution[m] });
      }

      byStore.push({
        store_id: storeId, store_name: st.name, future_shifts: futureShifts, tier,
        historical_months: result?.monthsUsed || [],
        productivity, raw_contribution: rawContribution,
        normalized_share: {}, metric_fallback: {}, final_plan: {}
      });
    }

    if (totalShifts <= 0) continue;
    itemsByEmployee.set(empId, {
      employee_id: emp.id, full_name: emp.full_name, total_shifts: totalShifts,
      by_store: byStore, final_plan: Object.fromEntries(metrics.map((m) => [m, 0])), warnings: []
    });
  }

  // Нормализация по (точка, метрика): доля вклада сотрудника * план точки,
  // с fallback "пропорционально будущим сменам", если сумма сырых вкладов нулевая.
  for (const [storeId, byMetric] of rawByStoreMetric) {
    const planRow = storePlans.get(storeId);
    const st = storeById.get(storeId);
    for (const [metric, contributions] of byMetric) {
      const plan = Number(planRow?.[metric]) || 0;
      if (plan <= 0) continue;
      const sum = contributions.reduce((a, c) => a + c.value, 0);
      let usedFallback = false;
      let shares: Map<string, number>;
      if (sum > 0) {
        shares = new Map(contributions.map((c) => [c.employee_id, c.value / sum]));
      } else {
        usedFallback = true;
        const totalFuture = futureByStore.get(storeId) || 0;
        shares = new Map(contributions.map((c) => {
          const shifts = futureByEmployeeStore.get(c.employee_id)?.get(storeId) || 0;
          return [c.employee_id, totalFuture > 0 ? shifts / totalFuture : 1 / contributions.length];
        }));
      }

      const decimals = unitOf.get(metric) === 'money' ? 2 : 0;
      const preRound = contributions.map((c) => (shares.get(c.employee_id) || 0) * plan);
      const rounded = largestRemainderRound(preRound, plan, decimals);

      contributions.forEach((c, idx) => {
        const item = itemsByEmployee.get(c.employee_id);
        const sb = item?.by_store.find((b) => b.store_id === storeId);
        if (!sb) return;
        sb.normalized_share[metric] = shares.get(c.employee_id) || 0;
        if (usedFallback) sb.metric_fallback[metric] = 'proportional_shifts';
        sb.final_plan[metric] = rounded[idx];
        if (item) item.final_plan[metric] = (item.final_plan[metric] || 0) + rounded[idx];
      });
    }
  }

  for (const item of itemsByEmployee.values()) {
    if (item.by_store.some((b) => b.tier === 'no_history')) {
      item.warnings.push('Нет исторических данных продаж ни на одной из точек — план распределён пропорционально числу смен');
    }
  }

  const items = [...itemsByEmployee.values()];
  const fingerprint = computeFingerprint(futureShiftRows, storePlans);

  const draft = await draftsRepo.createDraft(orgId, month, fingerprint, blockingErrors, generatedBy);
  await draftsRepo.insertDraftItems(draft.id, items.map((it) => ({
    employee_id: it.employee_id, total_shifts: it.total_shifts,
    by_store: it.by_store, final_plan: it.final_plan, warnings: it.warnings
  })));

  return { draft, items, blocking_errors: blockingErrors };
}

export async function viewDraft(draftId: number, orgId: string): Promise<{ draft: draftsRepo.DraftRow; items: draftsRepo.DraftItemRow[] } | null> {
  const draft = await draftsRepo.findDraftById(draftId, orgId);
  if (!draft) return null;
  const items = await draftsRepo.listDraftItems(draftId);
  return { draft, items };
}

/** APPLY — идемпотентно (повторный apply на уже applied черновике — no-op),
 * блокирует stale и черновики с blocking_errors.
 *
 * Staleness ре-проверяется и, если обнаружена, ПЕРСИСТИТСЯ (status='stale')
 * ДО открытия транзакции записи — иначе markStale() внутри транзакции,
 * которая затем откатывается броском StaleDraftError, был бы бесследно
 * потерян (ROLLBACK стирает и его). Сама запись employee_month_plans идёт
 * в отдельной, короткой транзакции (вызывающий код НЕ должен оборачивать
 * этот вызов в свой withTransaction — эта функция управляет транзакцией
 * записи сама, ради вышеописанного разделения). */
export async function applyDraft(draftId: number, orgId: string, appliedBy: number | null): Promise<{ draft: draftsRepo.DraftRow; applied: boolean }> {
  const draft = await draftsRepo.findDraftById(draftId, orgId);
  if (!draft) throw Object.assign(new Error('Черновик не найден'), { statusCode: 404 });

  if (draft.status === 'applied') return { draft, applied: false };
  if (draft.status === 'stale') throw new StaleDraftError();
  if ((draft.blocking_errors || []).length > 0) throw new DraftHasBlockingErrorsError(draft.blocking_errors);

  const metrics = await metricKeys();
  const { futureShiftRows, storePlans } = await loadDraftInputs(orgId, draft.month, metrics);
  const currentFingerprint = computeFingerprint(futureShiftRows, storePlans);
  if (currentFingerprint !== draft.input_fingerprint) {
    await draftsRepo.markStale(draft.id);
    throw new StaleDraftError();
  }

  return withTransaction(async () => {
    // Повторная блокировка+проверка под FOR UPDATE — закрывает узкое окно
    // гонки между проверкой выше и стартом транзакции (конкурентный apply
    // того же черновика, или изменение инпутов ровно в этот момент). Если
    // гонка всё же обнаружена здесь — просто бросаем без markStale (внутри
    // транзакции это было бы бессмысленно, см. комментарий функции выше);
    // следующая попытка apply поймает и запишет staleness через ветку выше.
    const locked = await draftsRepo.findDraftForUpdate(draftId, orgId);
    if (!locked) throw Object.assign(new Error('Черновик не найден'), { statusCode: 404 });
    if (locked.status === 'applied') return { draft: locked, applied: false };
    if (locked.status === 'stale') throw new StaleDraftError();

    const items = await draftsRepo.listDraftItems(locked.id);
    const monthStr = String(locked.month).slice(0, 10);
    for (const it of items) {
      const cols = ['employee_id', 'month', ...metrics];
      const vals: any[] = [it.employee_id, monthStr, ...metrics.map((m) => Number(it.final_plan[m]) || 0)];
      const updates = metrics.map((m) => `${m} = EXCLUDED.${m}`).join(', ');
      await plansRepo.upsertEmployeeMonthPlanRow(it.employee_id, monthStr, cols, vals, updates, it.final_plan as Record<string, number>);
    }

    await draftsRepo.markApplied(locked.id, appliedBy);
    const applied = await draftsRepo.findDraftById(locked.id, orgId);
    return { draft: applied!, applied: true };
  });
}
