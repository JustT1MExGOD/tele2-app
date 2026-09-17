/**
 * Admin Control Center, Phase 4+ — employee/store month plan corrections.
 *
 * Plans have no void concept — zeroing every metric already models "no
 * plan" (unlike sales/shifts, which need a distinct voided marker to
 * avoid ambiguity with a legitimately-zero row). Only single-metric
 * correct is added, mirroring correctSaleMetric's version-gated UPDATE.
 * No step-up — there's no org-transfer concept for a plan.
 *
 * Imports ONLY from core/plans/index.ts, never
 * data/repositories/plans.js directly — that module's own header comment
 * ("External modules must import from here ... never from
 * data/repositories/plans.js ... directly") is the one existing
 * bounded-context boundary this feature must respect rather than reach
 * around.
 */
import { withTransaction } from '../../data/db/index.js';
import * as auditRepo from '../../data/repositories/audit.js';
import {
  findEmployeeMonthPlanById, correctEmployeeMonthPlanMetric,
  findStoreMonthPlanById, correctStoreMonthPlanMetric,
  materializeStoreDailyPlans, metricKeys
} from '../plans/index.js';
import { metricLabelMap } from '../shared/metrics-catalog.js';
import { todayMoscow } from '../../utils/date.js';

const MAX_METRIC_VALUE = 2_147_483_647;

export class PlanVersionConflictError extends Error {
  constructor() {
    super('План был изменён другим администратором — обновите страницу и повторите');
    this.name = 'PlanVersionConflictError';
    Object.assign(this, { statusCode: 409 });
  }
}

export class PlanNotFoundError extends Error {
  constructor() {
    super('План не найден');
    this.name = 'PlanNotFoundError';
    Object.assign(this, { statusCode: 404 });
  }
}

export class PlanUnknownMetricError extends Error {
  constructor(metric: string) {
    super(`Неизвестная метрика "${metric}"`);
    this.name = 'PlanUnknownMetricError';
    Object.assign(this, { statusCode: 400 });
  }
}

export class PlanMetricValueRangeError extends Error {
  constructor(metric: string, value: number) {
    super(`Значение метрики "${metric}" (${value}) вне допустимого диапазона`);
    this.name = 'PlanMetricValueRangeError';
    Object.assign(this, { statusCode: 400 });
  }
}

interface Actor {
  employeeId: number;
  telegramId: number | null;
  role: string | null;
}

export async function planMetricsView(row: any): Promise<Record<string, { value: number; label: string }>> {
  const cols = await metricKeys();
  const labels = await metricLabelMap();
  const out: Record<string, { value: number; label: string }> = {};
  for (const c of cols) {
    out[c] = { value: Number(row[c]) || 0, label: labels[c] || c };
  }
  return out;
}

export async function correctEmployeePlanMetric(opts: {
  planId: number; metric: string; value: number; version: number; reason: string; actor: Actor; requestId?: string | null;
}) {
  const cols = await metricKeys();
  if (!cols.includes(opts.metric)) throw new PlanUnknownMetricError(opts.metric);
  if (!Number.isFinite(opts.value) || opts.value < 0 || opts.value > MAX_METRIC_VALUE) {
    throw new PlanMetricValueRangeError(opts.metric, opts.value);
  }

  return withTransaction(async (q) => {
    const row = await findEmployeeMonthPlanById(opts.planId, true, q);
    if (!row) throw new PlanNotFoundError();
    if (Number(row.version) !== opts.version) throw new PlanVersionConflictError();

    const prevVal = Number(row[opts.metric]) || 0;
    const updated = await correctEmployeeMonthPlanMetric(opts.planId, opts.metric, opts.value, opts.version, q);
    if (!updated) throw new PlanVersionConflictError();

    await auditRepo.record({
      orgId: row.employee_org_id,
      actorEmployeeId: opts.actor.employeeId,
      actorTelegramId: opts.actor.telegramId,
      action: 'EMPLOYEE_PLAN_CORRECTED',
      targetType: 'employee_month_plan',
      targetId: String(opts.planId),
      before: { [opts.metric]: prevVal },
      after: { [opts.metric]: opts.value, reason: opts.reason },
      requestId: opts.requestId ?? null,
      actorRole: opts.actor.role
    }, q);

    return updated;
  });
}

export async function correctStorePlanMetric(opts: {
  planId: number; metric: string; value: number; version: number; reason: string; actor: Actor; requestId?: string | null;
}) {
  const cols = await metricKeys();
  if (!cols.includes(opts.metric)) throw new PlanUnknownMetricError(opts.metric);
  if (!Number.isFinite(opts.value) || opts.value < 0 || opts.value > MAX_METRIC_VALUE) {
    throw new PlanMetricValueRangeError(opts.metric, opts.value);
  }

  let orgId: string = 'default';
  const updated = await withTransaction(async (q) => {
    const row = await findStoreMonthPlanById(opts.planId, true, q);
    if (!row) throw new PlanNotFoundError();
    if (Number(row.version) !== opts.version) throw new PlanVersionConflictError();
    orgId = row.store_org_id ?? 'default';

    const prevVal = Number(row[opts.metric]) || 0;
    const updatedRow = await correctStoreMonthPlanMetric(opts.planId, opts.metric, opts.value, opts.version, q);
    if (!updatedRow) throw new PlanVersionConflictError();

    await auditRepo.record({
      orgId: row.store_org_id,
      actorEmployeeId: opts.actor.employeeId,
      actorTelegramId: opts.actor.telegramId,
      action: 'STORE_PLAN_CORRECTED',
      targetType: 'store_month_plan',
      targetId: String(opts.planId),
      before: { [opts.metric]: prevVal },
      after: { [opts.metric]: opts.value, reason: opts.reason },
      requestId: opts.requestId ?? null,
      actorRole: opts.actor.role
    }, q);

    return updatedRow;
  });

  // Same re-materialization the manager-facing PUT /plans/stores/:id/month
  // route already does after any store-plan write, so the BFQ/live-map
  // snapshot (store_plans, read live by those features) never diverges
  // from the corrected month plan. Only relevant for the current month —
  // materializeStoreDailyPlans() only ever computes today/tomorrow.
  const month = String(updated.month).slice(0, 7);
  const today = todayMoscow();
  if (month === today.slice(0, 7)) {
    const target = { orgId, storeIds: [updated.store_id] };
    await materializeStoreDailyPlans(today, target);
    const tomorrow = new Date(today + 'T12:00:00Z');
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    if (tomorrow.toISOString().slice(0, 7) === month) {
      await materializeStoreDailyPlans(tomorrow.toISOString().slice(0, 10), target);
    }
  }

  return updated;
}
