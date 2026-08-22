/**
 * Data Access Layer (20.8.0, Full DAL) — SQL по таблицам `sales` и
 * `sales_audit`. applySaleUpsert() перенесена дословно из
 * services/sales-write.ts (единая точка записи продажи — POST /sales,
 * POST /sales/quick и /sync/batch раньше каждый вели свой собственный
 * INSERT ... ON CONFLICT, разошедшийся по деталям, см. её собственный
 * комментарий ниже) — самый рискованный перенос всей миграции 20.8.0,
 * сделан буквальным cut-paste, без рефакторинга по пути.
 */
import { query } from '../db/index.js';
import { logSaleEvents } from '../services/heatmap.js';

const SAFE_COLUMN = /^[a-z][a-z0-9_]{0,29}$/;
// Границы integer в Postgres — часть колонок метрик (sim/mnp/pa/combo/hb)
// именно такого типа. Раньше значение вроде 1e12 без проверки диапазона
// улетало прямо в INSERT и Postgres кидал необработанное исключение 22003
// "value out of range for type integer" (голый 500 вместо аккуратного 400).
// Единый потолок для всех метрик, не только integer-колонок — абсурдное
// число (1e15 аксессуаров) бессмысленно как бизнес-факт независимо от
// типа колонки в БД.
const MAX_METRIC_VALUE = 2_147_483_647;

export class SaleMetricRangeError extends Error {
  constructor(public metric: string, public value: number) {
    super(`Значение метрики "${metric}" (${value}) вне допустимого диапазона`);
    this.name = 'SaleMetricRangeError';
  }
}

export type SaleSource = 'api' | 'quick' | 'sync' | 'correction';

export type AppliedMetric = { metric: string; value: number };

/**
 * Аддитивно (+=, не =) — так и задумано: смысл в "прибавить N ещё", не
 * "задать итог". Best-effort (swallowed-exception) записи в sales_audit и
 * sales_events — асимметрия между ними (первая молча глотает, вторая
 * логирует warn) сохранена как есть, не "исправлена" по пути.
 */
export async function applySaleUpsert(opts: {
  employee_id: number;
  store_id: string;
  sale_date: string;
  metrics: Record<string, number>;
  source: SaleSource;
  createdByTelegramId?: number | null;
}): Promise<{ row: any; applied: AppliedMetric[] }> {
  const fields = Object.keys(opts.metrics).filter((k) => {
    const v = Number(opts.metrics[k]);
    return SAFE_COLUMN.test(k) && Number.isFinite(v) && v !== 0;
  });
  for (const f of fields) {
    const v = Number(opts.metrics[f]);
    if (Math.abs(v) > MAX_METRIC_VALUE) throw new SaleMetricRangeError(f, v);
  }
  if (!fields.length) return { row: null, applied: [] };

  const insertCols = ['employee_id', 'store_id', 'sale_date', ...fields];
  const insertVals: any[] = [
    opts.employee_id,
    opts.store_id,
    opts.sale_date,
    ...fields.map((f) => Number(opts.metrics[f]))
  ];
  const placeholders = insertVals.map((_, i) => `$${i + 1}`);
  const setParts = fields.map((f) => `${f} = GREATEST(0, sales.${f} + EXCLUDED.${f})`);
  setParts.push('updated_at = now()');

  const res = await query(
    `INSERT INTO sales (${insertCols.join(',')})
     VALUES (${placeholders.join(',')})
     ON CONFLICT (employee_id, store_id, sale_date)
     DO UPDATE SET ${setParts.join(', ')}
     RETURNING *`,
    insertVals
  );
  const row = res.rows[0];
  const applied: AppliedMetric[] = fields.map((f) => ({ metric: f, value: Number(opts.metrics[f]) }));

  try {
    for (const a of applied) {
      await query(
        `INSERT INTO sales_audit (employee_id, store_id, sale_date, metric, delta, source, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [opts.employee_id, opts.store_id, opts.sale_date, a.metric, a.value, opts.source, opts.createdByTelegramId || null]
      );
    }
  } catch (_) {}

  try {
    const metrics: Record<string, number> = {};
    for (const a of applied) metrics[a.metric] = a.value;
    await logSaleEvents({
      employee_id: opts.employee_id,
      store_id: opts.store_id,
      sale_date: opts.sale_date,
      metrics,
      source: opts.source
    });
  } catch (e) {
    console.warn('sales_events log failed:', (e as any)?.message || e);
  }

  return { row, applied };
}

/** services/alerts.ts — сумма базовых метрик точки за день (для проверки алертов). */
export async function sumMetricsForStoreDay(
  storeId: string, date: string
): Promise<{ sim: number; mnp: number; pa: number; combo: number }> {
  const res = await query(
    `SELECT COALESCE(SUM(sim),0) sim, COALESCE(SUM(mnp),0) mnp,
            COALESCE(SUM(pa),0) pa, COALESCE(SUM(combo),0) combo
     FROM sales WHERE store_id = $1 AND sale_date::date = $2::date`,
    [storeId, date]
  );
  return res.rows[0] || { sim: 0, mnp: 0, pa: 0, combo: 0 };
}

/** Колонки sales, которые реально есть в БД (кэш) — services/plans.ts, для
 * динамического подсчёта факта по существующим метрикам (кастомные метрики
 * добавляют колонки во время выполнения, не на этапе сборки). */
let salesColumnsCache: Set<string> | null = null;

export async function getSalesColumns(): Promise<Set<string>> {
  if (salesColumnsCache) return salesColumnsCache;
  try {
    const res = await query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'sales'`
    );
    salesColumnsCache = new Set(res.rows.map((r: any) => String(r.column_name)));
  } catch {
    salesColumnsCache = new Set([
      'sim', 'mnp', 'pa', 'combo', 'phones', 'accessories', 'focus', 'settings',
      'wink', 'shpd', 'insurance', 'credit_request', 'credit_issued', 'plotter', 'hb',
      'employee_id', 'store_id', 'sale_date'
    ]);
  }
  return salesColumnsCache;
}

/** services/plans.ts::getEmployeeMonthFacts — сумма произвольного набора
 * колонок-метрик за месяц одного сотрудника. */
export async function sumColumnsForEmployeeMonth(
  employeeId: number, start: string, end: string, columns: string[]
): Promise<Record<string, number>> {
  const selectParts = columns.map((c) => `COALESCE(SUM(${c}),0) as ${c}`);
  const res = await query(
    `SELECT ${selectParts.join(', ')}
     FROM sales
     WHERE employee_id = $1
       AND sale_date >= $2::date
       AND sale_date < $3::date`,
    [employeeId, start, end]
  );
  return res.rows[0] || {};
}

/** services/plans.ts::getStoreMonthFacts — то же самое, но по точке (не по сотруднику). */
export async function sumColumnsForStoreMonth(
  storeId: string, start: string, end: string, columns: string[]
): Promise<Record<string, number>> {
  const selectParts = columns.map((c) => `COALESCE(SUM(${c}),0) as ${c}`);
  const res = await query(
    `SELECT ${selectParts.join(', ')} FROM sales
     WHERE store_id = $1 AND sale_date >= $2::date AND sale_date < $3::date`,
    [storeId, start, end]
  );
  return res.rows[0] || {};
}

/** getEmployeeMonthFacts, ветка "ни одной ожидаемой колонки нет" (совсем старая схема) — без accessories. */
export async function sumVeryOldSchemaForEmployeeMonth(
  employeeId: number, start: string, end: string
): Promise<Record<string, number>> {
  const res = await query(
    `SELECT
       COALESCE(SUM(sim),0) as sim, COALESCE(SUM(mnp),0) as mnp,
       COALESCE(SUM(pa),0) as pa, COALESCE(SUM(combo),0) as combo,
       COALESCE(SUM(phones),0) as phones
     FROM sales
     WHERE employee_id = $1 AND sale_date >= $2::date AND sale_date < $3::date`,
    [employeeId, start, end]
  );
  return res.rows[0] || {};
}

/** getEmployeeMonthFacts, "последний шанс" — весь динамический путь упал целиком — с accessories. */
export async function sumMinimalForEmployeeMonth(
  employeeId: number, start: string, end: string
): Promise<Record<string, number>> {
  const res = await query(
    `SELECT
       COALESCE(SUM(sim),0) as sim, COALESCE(SUM(mnp),0) as mnp,
       COALESCE(SUM(pa),0) as pa, COALESCE(SUM(combo),0) as combo,
       COALESCE(SUM(phones),0) as phones,
       COALESCE(SUM(accessories),0) as accessories
     FROM sales
     WHERE employee_id = $1 AND sale_date >= $2::date AND sale_date < $3::date`,
    [employeeId, start, end]
  );
  return res.rows[0] || {};
}

/** GET /export/bi/daily — все продажи за день своей сети, с именами/точками (BI-выгрузка "правды" как есть). */
export async function findForBiDaily(date: string, orgId: string): Promise<any[]> {
  const res = await query(
    `SELECT s.*, e.full_name, COALESCE(st.display_name, st.name) as store_name, st.code
     FROM sales s
     JOIN employees e ON e.id = s.employee_id
     JOIN stores st ON st.id = s.store_id
     WHERE s.sale_date::date = $1::date AND COALESCE(st.org_id,'default') = $2`,
    [date, orgId]
  );
  return res.rows;
}

/** GET /me/insight, /me/day-plan-split — факт сотрудника за день, узкий набор колонок под эти экраны. */
export async function sumDayFactNarrow(employeeId: number, date: string): Promise<Record<string, number>> {
  const res = await query(
    `SELECT COALESCE(SUM(sim),0) sim, COALESCE(SUM(mnp),0) mnp,
            COALESCE(SUM(pa),0) pa, COALESCE(SUM(combo),0) combo,
            COALESCE(SUM(phones),0) phones, COALESCE(SUM(accessories),0) accessories
     FROM sales WHERE employee_id=$1 AND sale_date::date=$2::date`,
    [employeeId, date]
  );
  return res.rows[0] || {};
}

/** GET /me/day — факт сотрудника за один день, фиксированный набор колонок под этот экран. */
export async function sumDayFactForEmployee(employeeId: number, date: string): Promise<Record<string, number>> {
  const res = await query(
    `SELECT
       COALESCE(SUM(sim),0) as sim, COALESCE(SUM(mnp),0) as mnp,
       COALESCE(SUM(pa),0) as pa, COALESCE(SUM(combo),0) as combo,
       COALESCE(SUM(phones),0) as phones, COALESCE(SUM(accessories),0) as accessories,
       COALESCE(SUM(shpd),0) as shpd, COALESCE(SUM(wink),0) as wink,
       COALESCE(SUM(focus),0) as focus, COALESCE(SUM(insurance),0) as insurance,
       COALESCE(SUM(settings),0) as settings,
       COALESCE(SUM(credit_issued),0) as credit_issued,
       COALESCE(SUM(credit_request),0) as credit_request
     FROM sales
     WHERE employee_id = $1 AND sale_date::date = $2::date`,
    [employeeId, date]
  );
  return res.rows[0] || {};
}

/** GET /me/day — факт сотрудника с начала месяца (для «остаток плана»). */
export async function sumMonthFactForEmployee(employeeId: number, monthDate: string): Promise<Record<string, number>> {
  const res = await query(
    `SELECT
       COALESCE(SUM(sim),0) as sim,
       COALESCE(SUM(mnp),0) as mnp,
       COALESCE(SUM(pa),0) as pa,
       COALESCE(SUM(combo),0) as combo,
       COALESCE(SUM(phones),0) as phones,
       COALESCE(SUM(accessories),0) as accessories,
       COALESCE(SUM(settings),0) as settings,
       COALESCE(SUM(insurance),0) as insurance,
       COALESCE(SUM(wink),0) as wink,
       COALESCE(SUM(shpd),0) as shpd,
       COALESCE(SUM(focus),0) as focus
     FROM sales
     WHERE employee_id = $1
       AND sale_date >= $2::date
       AND sale_date < ($2::date + interval '1 month')`,
    [employeeId, monthDate]
  );
  return res.rows[0] || {};
}

/** GET /sales/history — own-network-or-own-record visibility, опциональные фильтры employee_id/store_id. */
export async function findHistory(opts: {
  from: string; to: string; orgId: string; ownEmployeeId: number;
  employeeFilter?: number | null; storeId?: string | null; limit: number;
}): Promise<any[]> {
  const params: any[] = [opts.from, opts.to, opts.orgId, opts.ownEmployeeId];
  let sql = `
    SELECT s.*, e.full_name, COALESCE(st.display_name, st.name) as store_name
    FROM sales s
    JOIN employees e ON e.id = s.employee_id
    JOIN stores st ON st.id = s.store_id
    WHERE s.sale_date >= $1 AND s.sale_date <= $2
      AND (COALESCE(st.org_id,'default') = $3 OR s.employee_id = $4)
  `;
  if (opts.employeeFilter) {
    params.push(opts.employeeFilter);
    sql += ` AND s.employee_id = $${params.length}`;
  }
  if (opts.storeId) {
    params.push(opts.storeId);
    sql += ` AND s.store_id = $${params.length}`;
  }
  params.push(opts.limit);
  sql += ` ORDER BY s.sale_date DESC, e.full_name LIMIT $${params.length}`;

  const res = await query(sql, params);
  return res.rows;
}

/** GET /sales/audit — правки продаж (sales_audit), опциональный фильтр по сотруднику. */
export async function findSalesAudit(opts: {
  from: string; to: string; orgId: string; employeeId?: number | null;
}): Promise<any[]> {
  const params: any[] = [opts.from, opts.to, opts.orgId];
  let sql = `
    SELECT a.*, e.full_name, COALESCE(st.display_name, st.name) as store_name
    FROM sales_audit a
    LEFT JOIN employees e ON e.id = a.employee_id
    LEFT JOIN stores st ON st.id = a.store_id
    WHERE a.sale_date >= $1 AND a.sale_date <= $2 AND COALESCE(st.org_id,'default') = $3
  `;
  if (opts.employeeId) {
    params.push(opts.employeeId);
    sql += ` AND a.employee_id = $${params.length}`;
  }
  sql += ` ORDER BY a.created_at DESC LIMIT 500`;
  const res = await query(sql, params);
  return res.rows;
}

/** GET /export/sales.csv — фиксированный набор колонок под CSV-экспорт, опциональный фильтр по точке. */
export async function findForCsvExport(opts: {
  from: string; to: string; orgId: string; storeId?: string | null;
}): Promise<any[]> {
  const params: any[] = [opts.from, opts.to, opts.orgId];
  let sql = `
    SELECT s.sale_date, e.full_name, COALESCE(st.display_name, st.name) as store_name, st.code,
           s.sim, s.mnp, s.pa, s.combo, s.phones, s.accessories,
           s.insurance, s.wink, s.shpd, s.focus, s.settings,
           s.credit_request, s.credit_issued, s.plotter, s.hb
    FROM sales s
    JOIN employees e ON e.id = s.employee_id
    JOIN stores st ON st.id = s.store_id
    WHERE s.sale_date >= $1 AND s.sale_date <= $2 AND COALESCE(st.org_id,'default') = $3
  `;
  if (opts.storeId) {
    params.push(opts.storeId);
    sql += ` AND s.store_id = $${params.length}`;
  }
  sql += ` ORDER BY s.sale_date, e.full_name`;
  const res = await query(sql, params);
  return res.rows;
}

/** services/anomaly.ts — история за 120 дней ДО заданной даты (сама дата исключена), по всем точкам разом. */
export async function findHistoricalTotals(
  storeIds: string[], beforeDate: string
): Promise<{ store_id: string; d: string; total: number }[]> {
  const res = await query(
    `SELECT store_id, sale_date::text as d,
            COALESCE(SUM(sim),0)+COALESCE(SUM(mnp),0)+COALESCE(SUM(pa),0)+COALESCE(SUM(combo),0) as total
     FROM sales
     WHERE store_id = ANY($1) AND sale_date >= ($2::date - interval '120 days') AND sale_date < $2::date
     GROUP BY store_id, sale_date`,
    [storeIds, beforeDate]
  ).catch(() => ({ rows: [] as any[] }));
  return res.rows;
}

/** services/anomaly.ts — фактический тотал за конкретную дату, по всем точкам разом. */
export async function findTotalsForDate(storeIds: string[], date: string): Promise<{ store_id: string; total: number }[]> {
  const res = await query(
    `SELECT store_id,
            COALESCE(SUM(sim),0)+COALESCE(SUM(mnp),0)+COALESCE(SUM(pa),0)+COALESCE(SUM(combo),0) as total
     FROM sales
     WHERE store_id = ANY($1) AND sale_date = $2::date
     GROUP BY store_id`,
    [storeIds, date]
  );
  return res.rows;
}

/** GET /sales — своя запись видна всегда, даже вне своей сети (self-inclusion). */
export async function findByDayForOrgOrSelf(
  saleDate: string, orgId: string, employeeId: number | null
): Promise<any[]> {
  const res = await query(
    `SELECT s.*, e.full_name, COALESCE(st.display_name, st.name) as store_name
     FROM sales s
     JOIN employees e ON e.id = s.employee_id
     JOIN stores st ON st.id = s.store_id
     WHERE s.sale_date = $1
       AND (COALESCE(st.org_id, 'default') = $2 OR s.employee_id = $3)
     ORDER BY e.full_name`,
    [saleDate, orgId, employeeId]
  );
  return res.rows;
}

/** Дедуп-путь POST /sales: если idempotency-ключ уже применён, вернуть существующую строку. */
export async function findOne(employeeId: number, storeId: string, saleDate: string): Promise<any | null> {
  const res = await query(
    `SELECT * FROM sales WHERE employee_id = $1 AND store_id = $2 AND sale_date = $3`,
    [employeeId, storeId, saleDate]
  );
  return res.rows[0] || null;
}

/** Только для уведомления в чат после успешной записи — намеренно не в
 * employees.ts/stores.ts, единственный вызывающий это POST /sales. */
export async function getNotificationInfo(
  employeeId: number, storeId: string
): Promise<{ full_name: string; store_name: string } | null> {
  const res = await query(
    `SELECT e.full_name, COALESCE(st.display_name, st.name) as store_name
     FROM employees e, stores st
     WHERE e.id = $1 AND st.id = $2`,
    [employeeId, storeId]
  );
  return res.rows[0] || null;
}

/** PUT /sales/:id/zero — "before"-контекст. metric приходит уже
 * провалидированным против getSalesSumColumns() (allowlist), безопасна
 * интерполяция имени колонки. */
export async function getZeroContext(
  saleId: string, metric: string
): Promise<{ val: number; employee_id: number; store_id: string; sale_date: string } | null> {
  const res = await query(
    `SELECT ${metric} as val, employee_id, store_id, sale_date FROM sales WHERE id = $1`,
    [saleId]
  );
  return res.rows[0] || null;
}

export async function zeroMetric(saleId: string, metric: string, q: typeof query = query): Promise<any | null> {
  const res = await q(`UPDATE sales SET ${metric} = 0, updated_at = now() WHERE id = $1 RETURNING *`, [saleId]);
  return res.rows[0] || null;
}

export async function insertCorrectionAudit(
  data: { employeeId: number; storeId: string; saleDate: string; metric: string; delta: number; createdByTelegramId: number | null },
  q: typeof query = query
): Promise<void> {
  await q(
    `INSERT INTO sales_audit (employee_id, store_id, sale_date, metric, delta, source, created_by)
     VALUES ($1,$2,$3,$4,$5,'correction',$6)`,
    [data.employeeId, data.storeId, data.saleDate, data.metric, data.delta, data.createdByTelegramId]
  );
}
