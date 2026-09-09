/**
 * Fallback-цепочка продуктивности employee-plan-generator (employee_store ->
 * store_avg -> org_avg) + largest-remainder округление. Чистая математика —
 * загрузка агрегатов (I/O) в application/employee-plan-draft.ts.
 */
import { monthStart, monthAdd, todayMoscow } from './date-helpers.js';

export const HIST_WEIGHTS = [0.5, 0.3, 0.2];

export function historicalMonths(asOf = todayMoscow()): { month: string; weight: number }[] {
  const currentStart = monthStart(asOf.slice(0, 7));
  return HIST_WEIGHTS.map((weight, i) => ({ month: monthAdd(currentStart, -1 - i), weight }));
}

/** 3 полных календарных месяца, непосредственно предшествующих ЯВНО выбранному
 * целевому месяцу (target-1, target-2, target-3) — напр. target=2026-09 ->
 * история 2026-06, 2026-07, 2026-08. Веса 50/30/20 от новейшего к самому
 * старому, как и раньше. Факт самого целевого месяца сюда никогда не
 * попадает — он строго после этого диапазона. */

export function historicalMonthsForTarget(targetMonth: string): { month: string; weight: number }[] {
  const targetStart = monthStart(targetMonth);
  return HIST_WEIGHTS.map((weight, i) => ({ month: monthAdd(targetStart, -1 - i), weight }));
}

export type MonthAgg = {
  month: string;
  weight: number;
  empStoreShifts: Map<string, Map<string, number>>;
  empStoreSales: Map<string, Map<string, Record<string, number>>>;
  storeShifts: Map<string, number>;
  storeSales: Map<string, Record<string, number>>;
  orgShifts: number;
  orgSales: Record<string, number>;
};

export type ProductivityResult = {
  productivity: Record<string, number>;
  monthsUsed: { month: string; shifts: number; weight: number }[];
};

export function weightedProductivity(
  months: MonthAgg[], metrics: string[],
  getShifts: (m: MonthAgg) => number, getSales: (m: MonthAgg) => Record<string, number> | undefined
): ProductivityResult | null {
  const weightedSum: Record<string, number> = Object.fromEntries(metrics.map((m) => [m, 0]));
  let weightTotal = 0;
  const monthsUsed: { month: string; shifts: number; weight: number }[] = [];
  for (const agg of months) {
    const shifts = getShifts(agg);
    if (shifts > 0) {
      const sales = getSales(agg) || {};
      for (const m of metrics) weightedSum[m] += agg.weight * (Number(sales[m]) || 0) / shifts;
      weightTotal += agg.weight;
      monthsUsed.push({ month: agg.month, shifts, weight: agg.weight });
    }
  }
  if (weightTotal <= 0) return null;
  const productivity: Record<string, number> = {};
  for (const m of metrics) productivity[m] = weightedSum[m] / weightTotal;
  return { productivity, monthsUsed };
}

export function largestRemainderRound(values: number[], target: number, decimals: number): number[] {
  const scale = 10 ** decimals;
  const scaledTarget = Math.round(target * scale);
  const floors = values.map((v) => Math.floor(v * scale));
  let remainder = scaledTarget - floors.reduce((a, b) => a + b, 0);
  const order = values.map((v, i) => ({ i, frac: v * scale - floors[i] }));
  if (remainder > 0) {
    order.sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (let k = 0; k < remainder && k < order.length; k++) floors[order[k].i] += 1;
  } else if (remainder < 0) {
    order.sort((a, b) => a.frac - b.frac || a.i - b.i);
    for (let k = 0; k < -remainder && k < order.length; k++) floors[order[k].i] -= 1;
  }
  return floors.map((v) => v / scale);
}

