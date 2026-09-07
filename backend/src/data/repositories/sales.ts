/**
 * Data Access Layer (20.8.0, Full DAL) — SQL по таблицам `sales` и
 * `sales_audit`. applySaleUpsert() перенесена дословно из
 * services/sales-write.ts (единая точка записи продажи — POST /sales,
 * POST /sales/quick и /sync/batch раньше каждый вели свой собственный
 * INSERT ... ON CONFLICT, разошедшийся по деталям, см. её собственный
 * комментарий ниже) — самый рискованный перенос всей миграции 20.8.0,
 * сделан буквальным cut-paste, без рефакторинга по пути.
 */
import { query, withTransaction } from '../db/index.js';
import { claimIdempotencyKey } from './sync-log.js';
import { evaluateAfterSale } from '../../core/employees/gamification.js';
import { getMetricDefs, getSalesSumColumns } from '../../core/shared/metrics-catalog.js';
import { hourMoscow, logSaleEvents } from '../../core/analytics/heatmap.js';

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
    Object.assign(this, {statusCode:400});
    this.name = 'SaleMetricRangeError';
  }
}

export type SaleSource = 'api' | 'quick' | 'sync' | 'correction';

export type AppliedMetric = { metric: string; value: number };

/** Additive write. Fact, idempotency receipt, journals and XP commit together. */
export async function applySaleUpsert(opts: {
  employee_id: number; store_id: string; sale_date: string;
  metrics: Record<string, number>; source: SaleSource;
  createdByTelegramId?: number | null; clientId?: string | null; occurredAt?: string;
}): Promise<{ row: any; applied: AppliedMetric[]; deduped?: boolean }> {
  const defs = await getMetricDefs();
  const allowed = new Set(defs.map(d=>d.id));
  const fields = Object.keys(opts.metrics).sort();
  for (const f of fields) {
    const v = Number(opts.metrics[f]);
    if (!SAFE_COLUMN.test(f) || !allowed.has(f) || !Number.isFinite(v) || Math.abs(v) > MAX_METRIC_VALUE || (defs.find(d=>d.id===f)?.unit === 'count' && !Number.isInteger(v))) {
      throw new SaleMetricRangeError(f, v);
    }
  }
  if (!fields.length) throw Object.assign(new Error('Не выбраны метрики'),{statusCode:400});
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.sale_date) || !Number.isFinite(Date.parse(opts.sale_date)) || new Date(opts.sale_date).toISOString().slice(0,10)!==opts.sale_date)
    throw Object.assign(new Error('Неверная дата продажи'),{statusCode:400});
  const payload = { employee_id: opts.employee_id, store_id: opts.store_id, sale_date: opts.sale_date,
    metrics: Object.fromEntries(fields.map(f => [f, Number(opts.metrics[f])])) };
  return withTransaction(async () => {
    if (opts.clientId) {
      const fresh = await claimIdempotencyKey(opts.clientId, opts.employee_id, opts.createdByTelegramId ?? null, payload);
      if (!fresh) {
        const old = (await query('SELECT payload,result FROM offline_sync_log WHERE client_id=$1', [opts.clientId])).rows[0];
        const oldMetrics = old?.payload?.metrics || {};
        if (!old?.result || Object.keys(oldMetrics).length !== fields.length ||
            fields.some(f => Number(oldMetrics[f]) !== payload.metrics[f]) ||
            Number(old.payload?.employee_id) !== opts.employee_id || old.payload?.store_id !== opts.store_id || old.payload?.sale_date !== opts.sale_date) {
          throw Object.assign(new Error('Результат операции требует сверки; повтор с изменёнными данными не применён'), {statusCode: 409});
        }
        return {...old.result, applied: [], deduped: true};
      }
    }
    // Serialize all writes, including zero corrections, for this daily row.
    await query(`INSERT INTO sales(employee_id,store_id,sale_date) VALUES($1,$2,$3)
      ON CONFLICT(employee_id,store_id,sale_date) DO NOTHING`, [opts.employee_id,opts.store_id,opts.sale_date]);
    const before = (await query(`SELECT * FROM sales WHERE employee_id=$1 AND store_id=$2 AND sale_date=$3 FOR UPDATE`,
      [opts.employee_id,opts.store_id,opts.sale_date])).rows[0];
    // PostgreSQL numeric arithmetic preserves decimal sums and effective deltas.
    for (const f of fields) {
      if (Number(before[f] || 0) + Number(opts.metrics[f]) > MAX_METRIC_VALUE)
        throw new SaleMetricRangeError(f,Number(before[f] || 0)+Number(opts.metrics[f]));
    }
    const values:any[]=[before.id];
    for(const f of fields) values.push(opts.metrics[f],before[f] || 0);
    const row=(await query(`UPDATE sales SET ${fields.map((f,i)=>`${f}=GREATEST(COALESCE(${f},0)+$${i*2+2}::numeric,0)`).join(',')},updated_at=now()
      WHERE id=$1 RETURNING *,${fields.map((f,i)=>`${f}-$${i*2+3}::numeric AS __delta_${i}`).join(',')}`,values)).rows[0];
    const applied:AppliedMetric[]=[];
    fields.forEach((f,i)=>{
      if(Number(row[f])>MAX_METRIC_VALUE) throw new SaleMetricRangeError(f,Number(row[f]));
      const delta=Number(row[`__delta_${i}`]);delete row[`__delta_${i}`];
      if(delta) applied.push({metric:f,value:delta});
    });
    for (const a of applied) await query(`INSERT INTO sales_audit(employee_id,store_id,sale_date,metric,delta,source,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,[opts.employee_id,opts.store_id,opts.sale_date,a.metric,a.value,opts.source,opts.createdByTelegramId ?? null]);
    const metrics = Object.fromEntries(applied.map(a=>[a.metric,a.value]));
    const occurred = opts.occurredAt ? new Date(opts.occurredAt) : undefined;
    if (occurred && !Number.isFinite(occurred.getTime())) throw Object.assign(new Error('Неверное время операции'),{statusCode:400});
    await logSaleEvents({...opts,metrics,hour:occurred ? hourMoscow(occurred) : undefined});
    await evaluateAfterSale(opts.employee_id,metrics);
    const result = {row,applied};
    if (opts.clientId) await query('UPDATE offline_sync_log SET result=$2 WHERE client_id=$1',[opts.clientId,JSON.stringify(result)]);
    return result;
  });
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
let salesColumnsAt = 0;
export function invalidateSalesColumns() { salesColumnsCache = null; }

export async function getSalesColumns(): Promise<Set<string>> {
  if (salesColumnsCache && Date.now() - salesColumnsAt < 30000) return salesColumnsCache;
  salesColumnsAt = Date.now();
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

/** core/plans/employee-plan-generator.ts — сумма метрик за месяц,
 * сгруппированная по (employee_id, store_id), одним запросом на всю сеть
 * (избегаем N+1 по сотрудникам/точкам при построении 3-месячной истории
 * продуктивности). columns приходят уже провалидированными вызывающим кодом
 * (тот же контракт, что у sumColumnsForEmployeeMonth/sumColumnsForStoreMonth
 * выше — regex-фильтр имён колонок делает services/plans.ts::metricKeys()). */
export async function sumColumnsByEmployeeStoreForOrgMonth(
  orgId: string, start: string, end: string, columns: string[]
): Promise<{ employee_id: number; store_id: string; [col: string]: number | string }[]> {
  const selectParts = columns.map((c) => `COALESCE(SUM(s.${c}),0) as ${c}`);
  const res = await query(
    `SELECT s.employee_id, s.store_id, ${selectParts.join(', ')}
     FROM sales s
     JOIN employees e ON e.id = s.employee_id
     WHERE COALESCE(e.org_id,'default') = $1
       AND s.sale_date >= $2::date AND s.sale_date < $3::date
       AND s.store_id IS NOT NULL
     GROUP BY s.employee_id, s.store_id`,
    [orgId, start, end]
  );
  return res.rows;
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
  const columns=await getSalesSumColumns();
  return (await query(`SELECT ${columns.map(c=>`COALESCE(SUM(${c}),0) AS ${c}`).join(',')}
    FROM sales WHERE employee_id=$1 AND sale_date=$2`,[employeeId,date])).rows[0] || {};
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
  saleId: string, metric: string, lock = false
): Promise<{ val: number; employee_id: number; store_id: string; sale_date: string } | null> {
  const res = await query(
    `SELECT ${metric} as val, employee_id, store_id, sale_date FROM sales WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`,
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
  await logSaleEvents({employee_id:data.employeeId,store_id:data.storeId,sale_date:data.saleDate,metrics:{[data.metric]:data.delta},source:'correction'});
}

/** Bounded keyset export; no long-lived transaction while a client downloads. */
export async function csvExportPage(opts:{from:string;to:string;orgId:string;storeId:string|null},cursor:{date:string;id:string}|null) {
  return (await query(`SELECT s.*,e.full_name,COALESCE(st.display_name,st.name) store_name,st.code
    FROM sales s JOIN employees e ON e.id=s.employee_id JOIN stores st ON st.id=s.store_id
    WHERE s.sale_date >= $1 AND s.sale_date <= $2 AND COALESCE(st.org_id,'default')=$3
      AND ($4::text IS NULL OR s.store_id=$4)
      AND ($5::date IS NULL OR (s.sale_date,s.id)>($5::date,$6::bigint))
    ORDER BY s.sale_date,s.id LIMIT 500`,[opts.from,opts.to,opts.orgId,opts.storeId,cursor?.date ?? null,cursor?.id ?? null])).rows;
}
