import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDailyFacts } from './lib/daily-facts.js';
import { recomputeReconciliation } from './lib/reconciliation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = (name: string) => readFileSync(path.join(__dirname, 'source', name), 'utf8');

const dailyFacts = loadDailyFacts(src('t2_legacy_daily_facts.csv'));
const recon = recomputeReconciliation(src('t2_legacy_monthly_actuals_source.csv'), dailyFacts);

const counts: Record<string, number> = {};
for (const r of recon) counts[r.status] = (counts[r.status] ?? 0) + 1;
console.log('status counts:', counts);
console.log('total rows:', recon.length);

const simRows = recon.filter((r) => r.metricId === 'sim' || r.metricId === 'combo');
console.log('sim/combo rows:', simRows.length, 'statuses:', [...new Set(simRows.map((r) => r.status))]);

// cross-check user-provided May/June SIM sums
const checks: [string, string, number][] = [
  ['2026-05', 'Каравашков Андрей Алексеевич', 156],
  ['2026-05', 'Бижонов Семен Михайлович', 138],
  ['2026-05', 'Степанов Алексей Юрьевич', 175],
  ['2026-05', 'Баранова София Андреевна', 93],
  ['2026-06', 'Каравашков Андрей Алексеевич', 169],
  ['2026-06', 'Бижонов Семен Михайлович', 113],
  ['2026-06', 'Степанов Алексей Юрьевич', 174],
  ['2026-06', 'Тутаев Никита Алексеевич', 112],
];
for (const [month, name, expected] of checks) {
  let sum = 0;
  for (const f of dailyFacts) {
    if (f.employeeName === name && f.date.startsWith(month)) sum += f.metrics.sim ?? 0;
  }
  console.log(month, name, 'daily sum sim =', sum, 'expected =', expected, sum === expected ? 'OK' : 'MISMATCH');
}

const trueNoDaily = recon.filter((r) => r.status === 'TRUE_NO_DAILY_DATA');
console.log('TRUE_NO_DAILY_DATA metric ids present:', [...new Set(trueNoDaily.map((r) => r.metricId))]);
