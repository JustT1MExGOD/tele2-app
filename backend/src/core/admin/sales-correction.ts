/**
 * Admin Control Center (20.59.0) — sales day-row corrections: void,
 * restore, correct-store.
 *
 * There is NO per-transaction "sale" entity in this schema — `sales`
 * (migration 0001_baseline.sql) is one additive daily aggregate row per
 * (employee_id, store_id, sale_date); the only per-event ledger,
 * `sales_events`, is a write-only heatmap feed with no correction API.
 * So everything here operates on the day-row, not on an imagined
 * transaction id — see docs/plan discussion for why.
 *
 * "Void" = zero every non-zero metric column on the row (reuses the
 * exact mechanism PUT /sales/:id/zero already uses per-metric, see
 * api/routes/sales.ts) + stamp voided_at/voided_by/void_reason. This
 * makes a voided row contribute 0 to every EXISTING aggregate query
 * (reports/plans/BFQ/rankings/...) with no changes needed to any of
 * them — the alternative (a status filter added to every aggregate
 * query across the codebase) would be a much larger, riskier blast
 * radius for the same outcome.
 *
 * "Restore" replays the exact pre-void metric snapshot recorded in the
 * SALE_VOIDED audit_log row's `before` field — not reconstructed from
 * sales_audit deltas, which would be ambiguous if multiple corrections
 * ever touch the same row.
 *
 * "Correct store" moves the day-row to a different store_id. Since
 * org attribution is always derived from stores.org_id (never stored on
 * `sales`), this IS the org correction — no separate org_id field
 * exists to touch, matching the "server derives org from store
 * ownership" invariant used everywhere else in this codebase (see
 * core/shifts/work-context.ts, actual-store.ts). Refuses if a row
 * already exists at the destination — merging two real day-rows is a
 * separate, harder problem, not attempted here.
 */
import { withTransaction, query } from '../../data/db/index.js';
import * as salesRepo from '../../data/repositories/sales.js';
import * as auditRepo from '../../data/repositories/audit.js';
import { getSalesSumColumns, metricLabelMap } from '../shared/metrics-catalog.js';

const MAX_METRIC_VALUE = 2_147_483_647;

export class SaleVersionConflictError extends Error {
  constructor() {
    super('Продажа была изменена другим администратором — обновите страницу и повторите');
    this.name = 'SaleVersionConflictError';
    Object.assign(this, { statusCode: 409 });
  }
}

export class SaleAlreadyVoidedError extends Error {
  constructor() {
    super('Продажа уже аннулирована');
    this.name = 'SaleAlreadyVoidedError';
    Object.assign(this, { statusCode: 400 });
  }
}

export class SaleNotVoidedError extends Error {
  constructor() {
    super('Продажа не аннулирована — восстанавливать нечего');
    this.name = 'SaleNotVoidedError';
    Object.assign(this, { statusCode: 400 });
  }
}

export class SaleNotFoundError extends Error {
  constructor() {
    super('Продажа не найдена');
    this.name = 'SaleNotFoundError';
    Object.assign(this, { statusCode: 404 });
  }
}

export class SaleDestinationExistsError extends Error {
  constructor() {
    super('На выбранной точке уже есть запись за этот день у этого сотрудника — перенос невозможен');
    this.name = 'SaleDestinationExistsError';
    Object.assign(this, { statusCode: 409 });
  }
}

export class SaleUnknownMetricError extends Error {
  constructor(metric: string) {
    super(`Неизвестная метрика "${metric}"`);
    this.name = 'SaleUnknownMetricError';
    Object.assign(this, { statusCode: 400 });
  }
}

export class SaleMetricValueRangeError extends Error {
  constructor(metric: string, value: number) {
    super(`Значение метрики "${metric}" (${value}) вне допустимого диапазона`);
    this.name = 'SaleMetricValueRangeError';
    Object.assign(this, { statusCode: 400 });
  }
}

export class SaleVoidedCannotCorrectError extends Error {
  constructor() {
    super('Продажа аннулирована — сначала восстановите её, затем корректируйте метрики');
    this.name = 'SaleVoidedCannotCorrectError';
    Object.assign(this, { statusCode: 400 });
  }
}

interface Actor {
  employeeId: number;
  telegramId: number | null;
  role: string | null;
}

async function nonZeroMetrics(row: any, metricCols: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const c of metricCols) {
    const v = Number(row[c]) || 0;
    if (v !== 0) out[c] = v;
  }
  return out;
}

export async function previewVoidSale(saleId: string) {
  const row = await salesRepo.findByIdForAdmin(saleId);
  if (!row) throw new SaleNotFoundError();
  if (row.voided_at) throw new SaleAlreadyVoidedError();
  const metricCols = await getSalesSumColumns();
  const affected = await nonZeroMetrics(row, metricCols);
  return { row, affectedMetrics: affected };
}

export async function voidSale(opts: {
  saleId: string; version: number; reason: string; actor: Actor; requestId?: string | null;
}) {
  const metricCols = await getSalesSumColumns();
  return withTransaction(async (q) => {
    const row = await salesRepo.findByIdForAdmin(opts.saleId, true, q);
    if (!row) throw new SaleNotFoundError();
    if (row.voided_at) throw new SaleAlreadyVoidedError();
    if (Number(row.version) !== opts.version) throw new SaleVersionConflictError();

    const before = await nonZeroMetrics(row, metricCols);
    const updated = await salesRepo.voidSaleRow(opts.saleId, opts.version, opts.actor.employeeId, opts.reason, metricCols, q);
    if (!updated) throw new SaleVersionConflictError();

    for (const [metric, val] of Object.entries(before)) {
      await salesRepo.insertCorrectionAudit(
        { employeeId: row.employee_id, storeId: row.store_id, saleDate: row.sale_date, metric, delta: -val, createdByTelegramId: opts.actor.telegramId },
        q
      );
    }
    await auditRepo.record({
      orgId: row.store_org_id,
      actorEmployeeId: opts.actor.employeeId,
      actorTelegramId: opts.actor.telegramId,
      action: 'SALE_VOIDED',
      targetType: 'sale',
      targetId: String(opts.saleId),
      before: { metrics: before, reason_context: null },
      after: { metrics: Object.fromEntries(Object.keys(before).map(k => [k, 0])), reason: opts.reason },
      requestId: opts.requestId ?? null,
      actorRole: opts.actor.role
    }, q);

    return updated;
  });
}

export async function restoreSale(opts: {
  saleId: string; version: number; reason: string; actor: Actor; requestId?: string | null;
}) {
  return withTransaction(async (q) => {
    const row = await salesRepo.findByIdForAdmin(opts.saleId, true, q);
    if (!row) throw new SaleNotFoundError();
    if (!row.voided_at) throw new SaleNotVoidedError();
    if (Number(row.version) !== opts.version) throw new SaleVersionConflictError();

    const lastVoid = (await q(
      `SELECT before FROM audit_log WHERE target_type = 'sale' AND target_id = $1 AND action = 'SALE_VOIDED' ORDER BY created_at DESC LIMIT 1`,
      [opts.saleId]
    )).rows[0];
    const metrics: Record<string, number> = lastVoid?.before?.metrics || {};

    const updated = await salesRepo.restoreSaleRow(opts.saleId, opts.version, metrics, q);
    if (!updated) throw new SaleVersionConflictError();

    for (const [metric, val] of Object.entries(metrics)) {
      await salesRepo.insertCorrectionAudit(
        { employeeId: row.employee_id, storeId: row.store_id, saleDate: row.sale_date, metric, delta: val, createdByTelegramId: opts.actor.telegramId },
        q
      );
    }
    await auditRepo.record({
      orgId: row.store_org_id,
      actorEmployeeId: opts.actor.employeeId,
      actorTelegramId: opts.actor.telegramId,
      action: 'SALE_RESTORED',
      targetType: 'sale',
      targetId: String(opts.saleId),
      before: { metrics: Object.fromEntries(Object.keys(metrics).map(k => [k, 0])) },
      after: { metrics, reason: opts.reason },
      requestId: opts.requestId ?? null,
      actorRole: opts.actor.role
    }, q);

    return updated;
  });
}

export async function previewCorrectSaleStore(saleId: string, newStoreId: string) {
  const row = await salesRepo.findByIdForAdmin(saleId);
  if (!row) throw new SaleNotFoundError();
  const destination = await salesRepo.findOne(row.employee_id, newStoreId, row.sale_date);
  const newStore = (await query(`SELECT id, COALESCE(display_name, name) as name, org_id FROM stores WHERE id = $1`, [newStoreId])).rows[0];
  return {
    row,
    destinationExists: !!destination,
    crossOrg: !!newStore && newStore.org_id !== row.store_org_id,
    newStore
  };
}

export async function correctSaleStore(opts: {
  saleId: string; version: number; newStoreId: string; reason: string; actor: Actor;
  stepUpVerified: boolean; requestId?: string | null;
}) {
  return withTransaction(async (q) => {
    const row = await salesRepo.findByIdForAdmin(opts.saleId, true, q);
    if (!row) throw new SaleNotFoundError();
    if (Number(row.version) !== opts.version) throw new SaleVersionConflictError();

    const destination = await salesRepo.findOne(row.employee_id, opts.newStoreId, row.sale_date, q);
    if (destination) throw new SaleDestinationExistsError();

    const newStore = (await q(`SELECT id, org_id FROM stores WHERE id = $1`, [opts.newStoreId])).rows[0];
    const crossOrg = !!newStore && newStore.org_id !== row.store_org_id;
    if (crossOrg && !opts.stepUpVerified) {
      throw Object.assign(new Error('Перенос продажи в другую сеть требует повторного подтверждения MFA'), { statusCode: 403, code: 'step_up_required' });
    }

    const updated = await salesRepo.moveSaleRowStore(opts.saleId, opts.version, opts.newStoreId, q);
    if (!updated) throw new SaleVersionConflictError();

    await auditRepo.record({
      orgId: row.store_org_id,
      actorEmployeeId: opts.actor.employeeId,
      actorTelegramId: opts.actor.telegramId,
      action: 'SALE_STORE_CORRECTED',
      targetType: 'sale',
      targetId: String(opts.saleId),
      before: { store_id: row.store_id },
      after: { store_id: opts.newStoreId, reason: opts.reason },
      requestId: opts.requestId ?? null,
      actorRole: opts.actor.role,
      targetOrgId: newStore?.org_id ?? null
    }, q);

    return updated;
  });
}

/**
 * Canonical (id, label, value) view of every known metric on a row, for
 * GET /admin/sales/:id. Built from getSalesSumColumns() (the same
 * allowlist reports/void-preview already trust as the source of truth
 * for "what is a metric column") rather than introspecting the row's own
 * keys — introspection previously undercounted, since Postgres `numeric`
 * columns (settings/accessories/insurance/phones/wink/focus/credit_issued/
 * plotter/hb/imp/import/esim/tst) come back from node-postgres as
 * strings, not numbers, so a naive `typeof v === 'number'` filter on the
 * frontend silently dropped roughly half the metrics.
 */
export async function saleMetricsView(row: any): Promise<Record<string, { value: number; label: string }>> {
  const cols = await getSalesSumColumns();
  const labels = await metricLabelMap();
  const out: Record<string, { value: number; label: string }> = {};
  for (const c of cols) {
    out[c] = { value: Number(row[c]) || 0, label: labels[c] || c };
  }
  return out;
}

export async function correctSaleMetric(opts: {
  saleId: string; metric: string; value: number; version: number; reason: string; actor: Actor; requestId?: string | null;
}) {
  const metricCols = await getSalesSumColumns();
  if (!metricCols.includes(opts.metric)) throw new SaleUnknownMetricError(opts.metric);
  if (!Number.isFinite(opts.value) || opts.value < 0 || opts.value > MAX_METRIC_VALUE) {
    throw new SaleMetricValueRangeError(opts.metric, opts.value);
  }

  return withTransaction(async (q) => {
    const row = await salesRepo.findByIdForAdmin(opts.saleId, true, q);
    if (!row) throw new SaleNotFoundError();
    if (row.voided_at) throw new SaleVoidedCannotCorrectError();
    if (Number(row.version) !== opts.version) throw new SaleVersionConflictError();

    const prevVal = Number(row[opts.metric]) || 0;
    const updated = await salesRepo.setMetric(opts.saleId, opts.metric, opts.value, opts.version, q);
    if (!updated) throw new SaleVersionConflictError();

    if (prevVal !== opts.value) {
      await salesRepo.insertCorrectionAudit(
        { employeeId: row.employee_id, storeId: row.store_id, saleDate: row.sale_date, metric: opts.metric, delta: opts.value - prevVal, createdByTelegramId: opts.actor.telegramId },
        q
      );
    }
    await auditRepo.record({
      orgId: row.store_org_id,
      actorEmployeeId: opts.actor.employeeId,
      actorTelegramId: opts.actor.telegramId,
      action: 'SALE_METRIC_CORRECTED',
      targetType: 'sale',
      targetId: String(opts.saleId),
      before: { [opts.metric]: prevVal },
      after: { [opts.metric]: opts.value, reason: opts.reason },
      requestId: opts.requestId ?? null,
      actorRole: opts.actor.role
    }, q);

    return updated;
  });
}
