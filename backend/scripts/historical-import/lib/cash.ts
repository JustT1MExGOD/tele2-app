import { parseCsv } from './csv.js';
import { storeIdForName } from './stores.js';

export interface CashRow {
  storeId: string;
  cashDate: string;
  cash1c: number | null;
  cashFact: number | null; // cash_actual
}

export type CashCategory = 'IMPORTABLE' | 'SKIP_WITH_WARNING';

export interface CashPlanRow extends CashRow {
  category: CashCategory;
  reason: string | null;
}

/**
 * cash_variance is always derivable (cash_fact - cash_1c) and store_cash has
 * no column for it, so it's intentionally not stored. Rows missing either
 * cash_1c or cash_actual can't be safely written (store_cash.cash_fact /
 * cash_1c are NOT NULL DEFAULT 0 — writing 0 would fabricate data) so they
 * are SKIP_WITH_WARNING, never defaulted to 0.
 */
export function loadCashPlan(csvText: string): CashPlanRow[] {
  const byKey = new Map<string, { storeId: string; cashDate: string; cash1c: number | null; cashFact: number | null }>();
  for (const row of parseCsv(csvText)) {
    if (row.record_type !== 'cash') continue;
    const storeId = storeIdForName(row.store);
    if (!storeId) continue;
    const cashDate = row.date;
    if (!cashDate) continue;
    const k = `${storeId} ${cashDate}`;
    let entry = byKey.get(k);
    if (!entry) {
      entry = { storeId, cashDate, cash1c: null, cashFact: null };
      byKey.set(k, entry);
    }
    const value = Number(row.value);
    if (!Number.isFinite(value)) continue;
    if (row.metric === 'cash_1c') entry.cash1c = value;
    else if (row.metric === 'cash_actual') entry.cashFact = value;
  }
  return [...byKey.values()].map((r) => {
    const complete = r.cash1c !== null && r.cashFact !== null;
    return {
      ...r,
      category: complete ? 'IMPORTABLE' : 'SKIP_WITH_WARNING',
      reason: complete ? null : 'INCOMPLETE_CASH_PAIR',
    };
  });
}
