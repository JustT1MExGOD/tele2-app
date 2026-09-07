/**
 * Canonical metric map — corrected per the second-audit finding that
 * SIM/Combo went missing from reconciliation only because
 * t2_legacy_daily_facts.csv/monthly_plans.csv use RU/uppercase literals
 * ("SIM","Комбо") while monthly_actuals_source.csv/reconciliation.csv use
 * EN/mixed-case literals ("Sim","Combo") for exactly those two metrics.
 * This is a translation, not a casing difference — every literal variant
 * is listed explicitly, never resolved via case-folding alone.
 *
 * "Кредит" (daily_fact/monthly_plan literal) is unambiguous only because
 * it's the single credit-shaped literal in those files: sampled values are
 * large monetary amounts (e.g. 19569, 31990), matching credit_issued's
 * semantics ("Кредит выдан", a sum), not a request count — mapped to
 * credit_issued on that basis; documented, not assumed silently.
 */
export const CANONICAL_METRIC_MAP: Record<string, string> = {
  HB: 'hb',
  'MNP-заявки': 'mnp',
  MNP: 'mnp',
  SIM: 'sim',
  Sim: 'sim',
  sim: 'sim',
  wink: 'wink',
  Wink: 'wink',
  Аксы: 'accessories',
  Аксессуары: 'accessories',
  'Доп услуги': 'settings',
  Комбо: 'combo',
  Combo: 'combo',
  Кредит: 'credit_issued',
  'Кредит выдан': 'credit_issued',
  'Кредит заявка': 'credit_request',
  ПА: 'pa',
  Плоттер: 'plotter',
  Страховки: 'insurance',
  Телефон: 'phones',
  Телефоны: 'phones',
  ФО: 'focus',
  ШПД: 'shpd',
  eSIM: 'esim',
  Импорт: 'import',
};

export function canonicalMetricId(rawLiteral: string): string | null {
  return CANONICAL_METRIC_MAP[rawLiteral.trim()] ?? null;
}

/** Columns on `sales` (per-day facts) that correspond 1:1 to plan_metrics ids. */
export const SALES_METRIC_COLUMNS = new Set([
  'sim', 'mnp', 'pa', 'combo', 'settings', 'accessories', 'insurance',
  'phones', 'wink', 'shpd', 'focus', 'credit_request', 'credit_issued',
  'plotter', 'hb', 'imp', 'import', 'esim', 'tst',
]);

/** Columns on `employee_month_plans` — same metric set, monthly grain. */
export const EMPLOYEE_MONTH_PLAN_METRIC_COLUMNS = SALES_METRIC_COLUMNS;
