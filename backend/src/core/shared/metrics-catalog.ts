/**
 * Единый каталог метрик из plan_metrics (+ fallback)
 */
import * as repo from '../../data/repositories/metrics.js';
import { METRICS } from '../../data/repositories/plans.js';

export type MetricDef = {
  id: string;
  label: string;
  short_label: string;
  unit: 'count' | 'money';
};

const FALLBACK: MetricDef[] = [
  { id: 'sim', label: 'SIM', short_label: 'SIM', unit: 'count' },
  { id: 'mnp', label: 'MNP', short_label: 'MNP', unit: 'count' },
  { id: 'pa', label: 'ПА', short_label: 'ПА', unit: 'count' },
  { id: 'combo', label: 'Комбо', short_label: 'Комбо', unit: 'count' },
  { id: 'phones', label: 'Телефоны', short_label: 'Тел', unit: 'money' },
  { id: 'accessories', label: 'Аксессуары', short_label: 'Аксы', unit: 'money' },
  { id: 'settings', label: 'Настройки', short_label: 'Доп', unit: 'money' },
  { id: 'insurance', label: 'Страховки', short_label: 'Страх', unit: 'money' },
  { id: 'wink', label: 'Wink', short_label: 'Wink', unit: 'money' },
  { id: 'shpd', label: 'ШПД', short_label: 'ШПД', unit: 'count' },
  { id: 'focus', label: 'ФО', short_label: 'ФО', unit: 'money' },
  { id: 'credit_request', label: 'Кредит заявка', short_label: 'Кр.з', unit: 'count' },
  { id: 'credit_issued', label: 'Кредит выдан', short_label: 'Кр.в', unit: 'money' },
  { id: 'plotter', label: 'Плоттер', short_label: 'Плот', unit: 'count' },
  { id: 'hb', label: 'НВ', short_label: 'НВ', unit: 'count' }
];

let cache: MetricDef[] | null = null;
let cacheAt = 0;
const TTL = 30_000;

export async function getMetricDefs(force = false): Promise<MetricDef[]> {
  if (!force && cache && Date.now() - cacheAt < TTL) return cache;
  try {
    const rows = await repo.listActiveDefs();
    if (rows.length) {
      const fromDb: MetricDef[] = rows.map((r: any) => ({
        id: String(r.id),
        label: r.label || r.id,
        short_label: r.short_label || r.label || r.id,
        unit: r.unit === 'money' ? 'money' : 'count'
      }));
      // Базовые метрики (sim/mnp/pa/...) никогда не становятся строками
      // plan_metrics автоматически — там живут только кастомные метрики,
      // заведённые через экран метрик (upsert() в
      // data/repositories/metrics.ts вызывается только из POST /metrics).
      // Если использовать ТОЛЬКО rows, то с первой же кастомной метрикой
      // любой сети базовые метрики молча исчезают из каталога (а значит
      // и из getEmployeeLeaderboard/валидации везде, где каталог —
      // источник истины) — это и произошло бы в проде, не только в
      // тесте. FALLBACK — гарантированный минимум, DB-строка того же id
      // (если когда-нибудь появится) её переопределяет.
      const ids = new Set(fromDb.map((m) => m.id));
      cache = [...fromDb, ...FALLBACK.filter((m) => !ids.has(m.id))];
      cacheAt = Date.now();
      return cache;
    }
  } catch (_) {}
  cache = FALLBACK;
  cacheAt = Date.now();
  return cache;
}

export async function getMetricIds(): Promise<string[]> {
  return (await getMetricDefs()).map((m) => m.id);
}

/**
 * Full metric key set (plans' base METRICS union any custom metric ids from
 * plan_metrics) — genuinely cross-cutting vocabulary consumed by sales,
 * plans, schedules/schedule-generator, employee-plan-generator, bfq, and
 * reports; moved here from core/plans (20.58.0 split, corr. #8) to break a
 * plans<->schedules import cycle, not to dodge a layering violation — this
 * has no owner-specific business meaning of its own.
 */
export async function metricKeys(): Promise<string[]> {
  return [...new Set<string>([...METRICS, ...await getMetricIds()])].filter((k) => /^[a-z][a-z0-9_]{0,29}$/.test(k));
}

export async function metricLabelMap(): Promise<Record<string, string>> {
  const defs = await getMetricDefs();
  const map: Record<string, string> = {};
  for (const m of defs) map[m.id] = m.label;
  return map;
}

/** Ключевые для микро-отчёта */
export const MICRO_KEYS = ['sim', 'mnp', 'pa', 'combo', 'phones', 'accessories', 'wink', 'shpd'];

/** Группы для итогового отчёта */
export function groupForMetric(id: string, label: string): 'gi' | 'top' | 'rt' | 'credit' | 'other' {
  const L = (id + ' ' + label).toLowerCase();
  if (['sim', 'mnp', 'pa'].includes(id) || /сим|mnp|па|золот|абик/.test(L)) return 'gi';
  if (['combo', 'phones', 'accessories', 'settings', 'insurance'].includes(id) ||
      /комбо|телефон|акс|настрой|страх/.test(L)) return 'top';
  if (['wink', 'shpd', 'focus'].includes(id) || /wink|шпд|фокус|ростел/.test(L)) return 'rt';
  if (id.includes('credit') || /кредит/.test(L)) return 'credit';
  return 'other';
}

export function invalidateMetricsCache() {
  cache = null;
  cacheAt = 0;
  colCache = null;
  colCacheAt = 0;
}

/**
 * Реальные числовые колонки таблицы sales — источник истины для сумм в
 * отчётах/дашборде. В отличие от getMetricIds() (список из plan_metrics,
 * которая не всегда синхронизирована с реальными столбцами — например,
 * колонки могли быть добавлены вручную миграцией) это гарантирует, что
 * ни одна метрика с продажами не пропадёт из отчётов молча.
 */
const NON_METRIC_COLUMNS = new Set([
  'id', 'employee_id', 'store_id', 'sale_date', 'created_at', 'updated_at',
  // 20.59.0 (Admin Control Center) — voided_by/version are bookkeeping
  // columns on `sales`, not sale facts; version is `integer` so without
  // this exclusion it would otherwise get picked up as a real metric.
  'voided_by', 'version'
]);

let colCache: string[] | null = null;
let colCacheAt = 0;

export async function getSalesSumColumns(force = false): Promise<string[]> {
  if (!force && colCache && Date.now() - colCacheAt < TTL) return colCache;
  try {
    const allCols = await repo.listNumericSalesColumns();
    const cols = allCols.filter((c: string) => !NON_METRIC_COLUMNS.has(c));
    if (cols.length) {
      colCache = cols;
      colCacheAt = Date.now();
      return colCache;
    }
  } catch (_) {}
  // fallback — старый жёсткий список, чтобы приложение не падало,
  // если information_schema почему-то недоступна
  colCache = FALLBACK.map((m) => m.id);
  colCacheAt = Date.now();
  return colCache;
}

/** SQL-фрагмент "COALESCE(SUM(col),0) as col, ..." по всем колонкам sales. */
export function buildSumSelect(columns: string[]): string {
  return columns.map((c) => `COALESCE(SUM(${c}),0) as ${c}`).join(', ');
}

export type LeaderboardResult = {
  metric: MetricDef;
  items: { rank: number; employee_id: number; full_name: string; value: number }[];
};

export type LeaderboardError = 'unknown_metric';

/** «Топы сотрудников» (план, 20.75.0) — топ по ОДНОЙ метрике каталога за
 * период, на произвольный набор сетей (org-switcher-aware вызывающая
 * сторона, см. api/routes/leaderboard.ts). Резолвит, где физически
 * живёт эта метрика — реальная numeric-колонка sales (getSalesSumColumns,
 * уже провалидированный источник имён колонок) или EAV-таблица
 * sale_metric_values — и зовёт repo.findEmployeeLeaderboard с нужным
 * флагом; сам metricId ПЕРЕД интерполяцией в SQL (repo-слой) проверяется
 * и против getMetricDefs() (каталог), и против getSalesSumColumns()
 * (реальные колонки) — unknown_metric, если ни там, ни там нет. */
export async function getEmployeeLeaderboard(
  orgIds: string[],
  metricId: string,
  from: string,
  to: string
): Promise<{ ok: true; result: LeaderboardResult } | { ok: false; error: LeaderboardError }> {
  const defs = await getMetricDefs();
  const metric = defs.find((m) => m.id === metricId);
  if (!metric) return { ok: false, error: 'unknown_metric' };
  const salesColumns = await getSalesSumColumns();
  const isSalesColumn = salesColumns.includes(metricId);
  const rows = await repo.findEmployeeLeaderboard(orgIds, metricId, from, to, isSalesColumn);
  return {
    ok: true,
    result: {
      metric,
      items: rows.map((r, i) => ({ rank: i + 1, employee_id: r.employee_id, full_name: r.full_name, value: r.value }))
    }
  };
}
