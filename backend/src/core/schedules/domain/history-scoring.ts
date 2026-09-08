/**
 * Историческая агрегация — почасовая продуктивность, fallback-цепочка +
 * shrinkage. Бакеты: employee+store+weekday -> employee+store -> employee
 * -> store+weekday -> store -> org. Чистая математика поверх уже
 * загруженных bucket'ов — сама загрузка (I/O) в application/generate-draft.ts.
 */
import * as W from './weights.js';

export type MetricBucket = { metricSum: Record<string, number>; hours: number };
export type HistBuckets = {
  empStoreWeekday: Map<string, MetricBucket>;
  empStore: Map<string, MetricBucket>;
  emp: Map<string, MetricBucket>;
  storeWeekday: Map<string, MetricBucket>;
  store: Map<string, MetricBucket>;
  org: MetricBucket;
};

export function emptyBucket(metrics: string[]): MetricBucket {
  return { metricSum: Object.fromEntries(metrics.map((m) => [m, 0])), hours: 0 };
}

export function addTo(map: Map<string, MetricBucket>, key: string, metrics: string[], weight: number, hours: number, row: any) {
  if (!map.has(key)) map.set(key, emptyBucket(metrics));
  const b = map.get(key)!;
  b.hours += weight * hours;
  for (const m of metrics) b.metricSum[m] += weight * (Number(row[m]) || 0);
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

