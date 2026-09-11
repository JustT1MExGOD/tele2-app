/**
 * Sandboxed sale-entry mission — reuses the EXISTING, already-audited
 * dry-run mechanism (window.__tutorialDryRun / __tutorialDryRunCallback,
 * owned by features/add-sale/index.ts) rather than building a second,
 * separate simulated form. The real "Добавить продажу" UI opens; its
 * submit is intercepted before any network call — see add-sale's own doc
 * comment on that flag. This module only adds validation against a
 * target metric mix on top of that existing guarantee.
 */
export interface SalePracticeTarget {
  /** metric id -> required quantity, e.g. { sim: 1, mnp: 1 } */
  metrics: Record<string, number>;
}

export interface SalePracticeResult {
  matched: boolean;
  got: Record<string, number>;
}

export const CHAPTER2_SALE_TARGET: SalePracticeTarget = { metrics: { sim: 1, mnp: 1 } };

function matchesTarget(target: SalePracticeTarget, payload: Record<string, unknown> | undefined): SalePracticeResult {
  const got: Record<string, number> = {};
  for (const key of Object.keys(target.metrics)) {
    got[key] = Number(payload?.[key]) || 0;
  }
  const matched = Object.entries(target.metrics).every(([key, needed]) => got[key] === needed) &&
    // Nothing extra beyond the target metrics either — a real "1 SIM + 1 MNP"
    // mission, not "at least that plus anything else".
    Object.keys(payload || {}).every((k) => {
      if (k in target.metrics) return true;
      if (['employee_id', 'store_id', 'sale_date', 'client_id', 'org_id'].includes(k)) return true;
      return !((payload as any)[k] > 0);
    });
  return { matched, got };
}

/**
 * Opens the real sale form in sandbox mode and resolves once the user
 * submits it — never before, never via a timeout. Never touches the real
 * API regardless of outcome (the interception happens inside add-sale
 * itself, before this module even sees the payload).
 */
export function beginSalePractice(target: SalePracticeTarget): Promise<SalePracticeResult> {
  return new Promise((resolve) => {
    window.__tutorialDryRun = true;
    window.__tutorialDryRunCallback = (payload?: Record<string, unknown>) => {
      window.__tutorialDryRun = false;
      window.__tutorialDryRunCallback = null;
      resolve(matchesTarget(target, payload));
    };
    try {
      window.openAddSale?.();
    } catch (e) {
      window.__tutorialDryRun = false;
      window.__tutorialDryRunCallback = null;
      console.warn('beginSalePractice: openAddSale failed', e);
      resolve({ matched: false, got: {} });
    }
  });
}
