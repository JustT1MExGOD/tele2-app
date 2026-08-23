/**
 * Единый каталог метрик из plan_metrics (+ fallback)
 */
import * as repo from '../../data/repositories/metrics.js';

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
      cache = rows.map((r: any) => ({
        id: String(r.id),
        label: r.label || r.id,
        short_label: r.short_label || r.label || r.id,
        unit: r.unit === 'money' ? 'money' : 'count'
      }));
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
  'id', 'employee_id', 'store_id', 'sale_date', 'created_at', 'updated_at'
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
