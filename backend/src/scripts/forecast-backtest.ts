/**
 * Backtest точности прогноза (core/analytics/forecast.ts::buildSesModel/
 * projectDay) — до этого скрипта точность модели нигде не измерялась,
 * только regression-тесты на конкретные баг-сценарии
 * (tests/unit/forecast-model.test.ts).
 *
 * Метод: скользящее окно. Для каждой точки и каждого дня в тестовом
 * периоде строим модель СТРОГО по 120 дням, предшествующим этому дню
 * (то же окно, что forecastStore/forecastRemainingOfMonth используют в
 * проде), прогнозируем именно этот день через projectDay(model, dow) и
 * сравниваем с реальным фактом. Пропуски внутри истории дозаполняются
 * нулями — тот же приём, что в проде (иначе сглаженный уровень никогда
 * не видит настоящий 0).
 *
 * Read-only — только SELECT, никаких записей. Требует DATABASE_URL
 * (см. backend/.env.test — тот же прокси, что разрешён для
 * read-only расследований по CLAUDE.md).
 *
 * Usage:
 *   npx tsx src/scripts/forecast-backtest.ts [--org=default] [--test-days=30] [--store=<id>]
 *
 *   npx tsx src/scripts/forecast-backtest.ts --holiday-check [--test-days=300]
 *     Сравнивает точность прогноза НА КОНКРЕТНЫЕ праздничные даты (НГ,
 *     Рождество, 23 февраля, 8 марта, майские, День России, 4 ноября)
 *     против соседних будних дней (±3 дня) — проверка гипотезы, что модель
 *     систематически промахивается именно на известных нерабочих/особых
 *     датах, а не только "рано в месяце" (см. day-of-month диагностику).
 */
import { pathToFileURL } from 'node:url';
import '../env.js';
import { query } from '../data/db/index.js';
import { buildSesModel, projectDay } from '../core/analytics/forecast.js';

const METRICS = ['sim', 'mnp', 'pa', 'combo'] as const;
const WINDOW_DAYS = 120;

function parseArgs() {
  const args = process.argv.slice(2);
  const org = args.find((a) => a.startsWith('--org='))?.split('=')[1] || 'default';
  const testDays = Math.max(1, Number(args.find((a) => a.startsWith('--test-days='))?.split('=')[1]) || 30);
  const storeFilter = args.find((a) => a.startsWith('--store='))?.split('=')[1];
  const holidayCheck = args.includes('--holiday-check');
  return { org, testDays, storeFilter, holidayCheck };
}

/** Известные праздничные/особые даты внутри окна данных (2025-11 — сейчас). */
const HOLIDAYS = ['2025-11-04', '2026-01-01', '2026-01-07', '2026-02-23', '2026-03-08', '2026-05-01', '2026-05-09', '2026-06-12'];

async function listStores(org: string, storeFilter?: string): Promise<{ id: string; name: string }[]> {
  if (storeFilter) {
    const res = await query(`SELECT id, COALESCE(display_name, name) as name FROM stores WHERE id = $1`, [storeFilter]);
    return res.rows;
  }
  const res = await query(
    `SELECT id, COALESCE(display_name, name) as name FROM stores WHERE COALESCE(is_active,true)=true AND COALESCE(org_id,'default') = $1`,
    [org]
  );
  return res.rows;
}

/** Плотный (без пропусков) ряд дневных сумм для точки, [fromDate, toDate). */
async function denseDailySeries(storeId: string, fromDate: string, toDate: string) {
  const res = await query(
    `SELECT sale_date::text as d, COALESCE(SUM(sim),0) sim, COALESCE(SUM(mnp),0) mnp,
            COALESCE(SUM(pa),0) pa, COALESCE(SUM(combo),0) combo
     FROM sales
     WHERE store_id = $1 AND sale_date >= $2::date AND sale_date < $3::date
     GROUP BY sale_date`,
    [storeId, fromDate, toDate]
  );
  const byDate = new Map<string, any>(res.rows.map((r: any) => [r.d, r]));

  const out: { date: string; dow: number; [k: string]: number | string }[] = [];
  const cursor = new Date(fromDate + 'T12:00:00');
  const end = new Date(toDate + 'T12:00:00');
  while (cursor < end) {
    const key = cursor.toISOString().slice(0, 10);
    const r = byDate.get(key);
    const row: { date: string; dow: number; [k: string]: number | string } = { date: key, dow: cursor.getDay() };
    for (const m of METRICS) row[m] = r ? Number(r[m]) || 0 : 0;
    out.push(row);
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

interface ErrorAcc {
  n: number;
  sumAbsErr: number;
  sumSqErr: number;
  sumErr: number; // signed, for bias
  sumActual: number;
  /** SMAPE — symmetric, defined even when actual=0 (unlike MAPE). */
  sumSmape: number;
}

function newAcc(): ErrorAcc {
  return { n: 0, sumAbsErr: 0, sumSqErr: 0, sumErr: 0, sumActual: 0, sumSmape: 0 };
}

function record(acc: ErrorAcc, predicted: number, actual: number) {
  const err = predicted - actual;
  acc.n++;
  acc.sumAbsErr += Math.abs(err);
  acc.sumSqErr += err * err;
  acc.sumErr += err;
  acc.sumActual += actual;
  const denom = Math.abs(predicted) + Math.abs(actual);
  acc.sumSmape += denom === 0 ? 0 : (2 * Math.abs(err)) / denom;
}

function summarize(acc: ErrorAcc, label: string) {
  if (!acc.n) return `${label}: нет данных`;
  const mae = acc.sumAbsErr / acc.n;
  const rmse = Math.sqrt(acc.sumSqErr / acc.n);
  const bias = acc.sumErr / acc.n;
  const smape = (acc.sumSmape / acc.n) * 100;
  const avgActual = acc.sumActual / acc.n;
  return (
    `${label}: n=${acc.n}  MAE=${mae.toFixed(2)}  RMSE=${rmse.toFixed(2)}  ` +
    `bias=${bias >= 0 ? '+' : ''}${bias.toFixed(2)}  SMAPE=${smape.toFixed(1)}%  ` +
    `(средний факт/день=${avgActual.toFixed(2)})`
  );
}

async function main() {
  const { org, testDays, storeFilter, holidayCheck } = parseArgs();
  const stores = await listStores(org, storeFilter);
  if (!stores.length) {
    console.log('Точек не найдено — проверьте --org/--store.');
    return;
  }

  if (holidayCheck) {
    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);
    const seriesFrom = new Date(today);
    seriesFrom.setDate(seriesFrom.getDate() - (WINDOW_DAYS + testDays));
    const seriesFromIso = seriesFrom.toISOString().slice(0, 10);

    const holidayAcc: Record<string, ErrorAcc> = {};
    const neighborAcc: Record<string, ErrorAcc> = {};
    for (const m of METRICS) {
      holidayAcc[m] = newAcc();
      neighborAcc[m] = newAcc();
    }
    const perHoliday: Record<string, Record<string, ErrorAcc>> = {};
    for (const h of HOLIDAYS) {
      perHoliday[h] = {};
      for (const m of METRICS) perHoliday[h][m] = newAcc();
    }

    for (const store of stores) {
      const series = await denseDailySeries(store.id, seriesFromIso, todayIso);
      if (series.length < WINDOW_DAYS + 1) continue;
      const byDate = new Map(series.map((r, idx) => [r.date, idx]));

      for (const h of HOLIDAYS) {
        const idx = byDate.get(h);
        if (idx === undefined || idx < WINDOW_DAYS) continue;
        const windowRows = series.slice(idx - WINDOW_DAYS, idx);
        const testRow = series[idx];
        for (const m of METRICS) {
          const model = buildSesModel(windowRows.map((r) => ({ dow: r.dow, value: Number(r[m]) })));
          const predicted = projectDay(model, testRow.dow);
          const actual = Number(testRow[m]);
          record(holidayAcc[m], predicted, actual);
          record(perHoliday[h][m], predicted, actual);
        }

        for (const offset of [-3, -2, -1, 1, 2, 3]) {
          const nIdx = idx + offset;
          if (nIdx < WINDOW_DAYS || nIdx >= series.length) continue;
          const nWindowRows = series.slice(nIdx - WINDOW_DAYS, nIdx);
          const nTestRow = series[nIdx];
          for (const m of METRICS) {
            const model = buildSesModel(nWindowRows.map((r) => ({ dow: r.dow, value: Number(r[m]) })));
            const predicted = projectDay(model, nTestRow.dow);
            const actual = Number(nTestRow[m]);
            record(neighborAcc[m], predicted, actual);
          }
        }
      }
    }

    console.log(`Праздничные даты в окне данных: ${HOLIDAYS.join(', ')}\n`);
    console.log('=== Прогноз НА праздничную дату (все метрики вместе) ===');
    for (const m of METRICS) console.log(summarize(holidayAcc[m], m));
    console.log('\n=== Прогноз на соседние дни (±1..3 дня от праздника, не праздник) ===');
    for (const m of METRICS) console.log(summarize(neighborAcc[m], m));
    console.log('\n=== По каждой праздничной дате (все метрики вместе) ===');
    for (const h of HOLIDAYS) {
      const n = Object.values(perHoliday[h]).reduce((s, a) => s + a.n, 0);
      if (!n) continue;
      for (const m of METRICS) console.log(`  ${h} ${summarize(perHoliday[h][m], m)}`);
    }
    return;
  }

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const seriesFrom = new Date(today);
  seriesFrom.setDate(seriesFrom.getDate() - (WINDOW_DAYS + testDays));
  const seriesFromIso = seriesFrom.toISOString().slice(0, 10);

  const overall: Record<string, ErrorAcc> = {};
  for (const m of METRICS) overall[m] = newAcc();
  const perStore: Record<string, Record<string, ErrorAcc>> = {};

  console.log(`Backtest прогноза — org=${org}, test-days=${testDays}, точек=${stores.length}`);
  console.log(`Окно модели: ${WINDOW_DAYS} дней. Тестовый период: последние ${testDays} дней перед ${todayIso}.\n`);

  for (const store of stores) {
    const series = await denseDailySeries(store.id, seriesFromIso, todayIso);
    if (series.length < WINDOW_DAYS + 1) continue; // недостаточно истории для честного backtest

    perStore[store.id] = {};
    for (const m of METRICS) perStore[store.id][m] = newAcc();

    // i — индекс тестируемого дня; окно модели строго [i-WINDOW_DAYS, i)
    for (let i = WINDOW_DAYS; i < series.length; i++) {
      const windowRows = series.slice(i - WINDOW_DAYS, i);
      const testRow = series[i];
      for (const m of METRICS) {
        const model = buildSesModel(windowRows.map((r) => ({ dow: r.dow, value: Number(r[m]) })));
        const predicted = projectDay(model, testRow.dow);
        const actual = Number(testRow[m]);
        record(overall[m], predicted, actual);
        record(perStore[store.id][m], predicted, actual);
      }
    }
  }

  const testedStores = Object.keys(perStore);
  console.log(`Точек с достаточной историей (>= ${WINDOW_DAYS + 1} дней): ${testedStores.length} из ${stores.length}\n`);

  console.log('=== Итог по сети (все точки, все дни теста) ===');
  for (const m of METRICS) {
    console.log(summarize(overall[m], m));
  }

  if (testedStores.length && testedStores.length <= 30) {
    console.log('\n=== По точкам ===');
    for (const storeId of testedStores) {
      const name = stores.find((s) => s.id === storeId)?.name || storeId;
      console.log(`\n${name} (${storeId}):`);
      for (const m of METRICS) {
        console.log('  ' + summarize(perStore[storeId][m], m));
      }
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
