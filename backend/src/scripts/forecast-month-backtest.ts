/**
 * Backtest точности МЕСЯЧНОГО прогноза — того самого числа, которое
 * кабинет супервайзера показывает как «прогноз выполнения плана к концу
 * месяца» (core/analytics/supervisor.ts::forecastRemainingOfMonth:
 * факт с начала месяца + сумма projectDay() по оставшимся дням).
 *
 * Отличается от forecast-backtest.ts (тот меряет точность прогноза ОДНОГО
 * дня вперёд) — здесь на каждую контрольную дату внутри месяца строим
 * прогноз ИТОГА МЕСЯЦА (как это реально показывает UI) и сравниваем с
 * фактическим итогом месяца, который уже случился.
 *
 * Read-only. Требует DATABASE_URL.
 *
 * Usage:
 *   npx tsx src/scripts/forecast-month-backtest.ts [--org=default] [--store=<id>]
 *   [--checkpoints=5,10,15,20,25]
 *
 *   npx tsx src/scripts/forecast-month-backtest.ts --grid-search
 *     Перебирает ALPHA/BETA/PHI/SHRINK_K по сетке на уже загруженных из БД
 *     данных (один запрос к БД, дальше всё в памяти) и печатает топ-10
 *     комбинаций по средней SMAPE — используется для подбора констант в
 *     core/analytics/forecast.ts, не запускается в проде.
 *
 *   npx tsx src/scripts/forecast-month-backtest.ts --runrate-check
 *     Сравнивает точность SES-прогноза остатка месяца с плоским run-rate
 *     (factToDate/прошедшие_дни × оставшиеся_дни) и их блендом — источник
 *     решения перейти на run-rate в forecastRemainingOfMonth (supervisor.ts).
 *
 *   npx tsx src/scripts/forecast-month-backtest.ts --store-bias-check
 *     Пробует ГЛОБАЛЬНО другой подход к run-rate: поправка на систематическое
 *     отклонение конкретной точки (leave-one-out — среднее отношение факт/
 *     прогноз по ВСЕМ ДРУГИМ чек-поинтам той же точки и метрики, кроме
 *     текущего, чтобы не было утечки данных), с зажимом ±1.2/1.5/2/3×.
 *     Результат: не помогает — лучший вариант это отсутствие поправки
 *     (зажим 1× = no-op = базовые 3.94%), более широкий зажим только ухудшает
 *     (1.2×→4.03%, 1.5-3×→4.16%). Систематического per-store смещения,
 *     которое можно было бы корректировать, в данных нет.
 *
 *   npx tsx src/scripts/forecast-month-backtest.ts --median-pace-check
 *     Пробует ГЛОБАЛЬНО другой подход: медиана дневных значений с начала
 *     месяца вместо среднего (run-rate использует среднее) — устойчивее к
 *     выбросам в теории. Результат: хуже среднего на КАЖДОМ чек-поинте
 *     (итого 4.82% против 3.94%; д5=8.48%, д10=6.76%, д15=4.62%, д20=2.80%,
 *     д25=1.83%). При малом числе прошедших дней медиана слишком грубая
 *     оценка типичного дня.
 *
 *   npx tsx src/scripts/forecast-month-backtest.ts --weighted-pace-check
 *     Пробует "сложный" метод: EWMA (экспоненциально взвешенный пейс) —
 *     недавние дни месяца весят больше давних, вместо равного веса у
 *     плоского среднего. Результат: decay=0.9-0.92 даёт 3.91% против 3.94%
 *     — на 0.03pp лучше, но выигрыш только на д20/д25, ценой чуть худшего
 *     д15. На грани шума при 748 чек-поинтах — тот же случай, что
 *     --window-search (0.15pp): слишком маленький эффект, чтобы усложнять
 *     прод-формулу.
 *
 *   npx tsx src/scripts/forecast-month-backtest.ts --trend-regression-check
 *     Пробует ещё более "сложный" метод: OLS-регрессия дневного факта по
 *     номеру дня месяца, линейная экстраполяция тренда вместо константного
 *     пейса. Результат: 6.37% против 3.94% — заметно хуже, катастрофично на
 *     д5 (14.07%). Наклон переобучается на коротком шумном окне и разносит
 *     ошибку экстраполяцией на ~20 дней вперёд.
 *
 *   npx tsx src/scripts/forecast-month-backtest.ts --ensemble-check
 *     Пробует объединить несколько разных методов (run-rate, EWMA(0.9),
 *     SES-сумма) усреднением вместо выбора одного лучшего. Результат: любая
 *     примесь SES-суммы (соло 5.01%) тянет ансамбль вниз пропорционально
 *     весу; run-rate+EWMA пополам даёт 3.92% — между ними, без выигрыша
 *     сверх лучшего одиночного метода. Run-rate и EWMA слишком коррелированы
 *     (оба считаются по одному и тому же факту месяца) — нет диверсификации
 *     ошибок, которая нужна ансамблю, чтобы реально выигрывать.
 *
 *   npx tsx src/scripts/forecast-month-backtest.ts --anomaly-exclude-pace-check
 *     Точечно исключает из расчёта пейса дни, помеченные аномалией тем же
 *     Z_THRESHOLD=2 принципом, что core/alerts/anomaly.ts (не клэмп, как
 *     winsorizing, а полное исключение дня). Результат: 4.28% против 3.94%
 *     — хуже. Исключённые дни (1.3% от всех) — это чаще реальный, просто
 *     редкий спрос, а не шум; вырезать их — терять сигнал, а не убирать помеху.
 *
 *   npx tsx src/scripts/forecast-month-backtest.ts --dow-direct-pace-check
 *     Пейс по дню недели напрямую, БЕЗ SES-модели (в отличие от уже
 *     проверенной "поправки на состав дня недели" через SES-сезонность в
 *     --runrate-check). Результат: 3.95% — статистически неотличимо от
 *     обычного run-rate. Раскладка по дням недели не добавляет сигнала,
 *     которого не было бы уже в простом среднем.
 *
 *   npx tsx src/scripts/forecast-month-backtest.ts --network-factor-check
 *     Сетевой день-фактор: если вся сеть (не одна точка, в отличие от
 *     --store-bias-check) в последние 7 прошедших дней шла выше/ниже
 *     обычного пейса, экстраполирует это на оставшиеся дни КАЖДОЙ точки.
 *     Результат: 3.93% — на грани шума (тот же масштаб эффекта, что EWMA),
 *     не стоит усложнения.
 *
 *   npx tsx src/scripts/forecast-month-backtest.ts --interval-check
 *     Не про точность, а про честность доверительного интервала: сравнивает
 *     эмпирическое покрытие ±1σ у (a) текущего прод-варианта stdev
 *     (SES-модель, унаследована с эпохи SES-суммы), (b) stdev по разбросу
 *     прошедших дней месяца (согласовано с run-rate точечным прогнозом),
 *     (c) bootstrap-ресэмплинга. Результат: 94.5% / 93.5% / 93.5% — все три
 *     дают похожее (заметно выше номинальных 68% для нормального
 *     распределения) покрытие. Несостыковка "точка — run-rate, интервал —
 *     SES" на практике не портит калибровку: она и так одинаково широкая
 *     у всех трёх методов, менять stdev на run-rate-согласованный не нужно.
 *
 *   npx tsx src/scripts/forecast-month-backtest.ts --weighted-metric-check
 *     Проверяет, меняется ли ранжирование методов (run-rate vs EWMA(0.9))
 *     при другом взвешивании ошибки по чек-поинтам (равный вес / вес
 *     1/checkpointDay — ранние важнее / вес checkpointDay — поздние важнее).
 *     Результат: EWMA стабильно чуть лучше run-rate при любом взвешивании
 *     (на 0.01-0.04pp) — ранжирование не переворачивается, но выигрыш везде
 *     слишком мал, чтобы усложнять прод.
 *
 *   npx tsx src/scripts/forecast-month-backtest.ts --cold-start
 *     Делит чек-поинты по объёму РЕАЛЬНОЙ истории точки на дату чек-поинта
 *     (дни с первой ненулевой продажи, а не длина окна — окно всегда
 *     зафиксировано в 120 дней и молча дозаполняется нулями, если реальной
 *     истории меньше) и сравнивает SMAPE между "молодыми" и "зрелыми"
 *     точками — проверка гипотезы, что для недавно открытых/импортированных
 *     точек прогноз хуже из-за нулевого паддинга окна.
 */
import { pathToFileURL } from 'node:url';
import '../env.js';
import { query } from '../data/db/index.js';
import { buildSesModel, projectDay, projectDayStdev } from '../core/analytics/forecast.js';

const METRICS = ['sim', 'mnp', 'pa', 'combo'] as const;
let WINDOW_DAYS = 120;

function parseArgs() {
  const args = process.argv.slice(2);
  const org = args.find((a) => a.startsWith('--org='))?.split('=')[1] || 'default';
  const storeFilter = args.find((a) => a.startsWith('--store='))?.split('=')[1];
  const checkpointsArg = args.find((a) => a.startsWith('--checkpoints='))?.split('=')[1];
  const checkpoints = (checkpointsArg ? checkpointsArg.split(',').map(Number) : [5, 10, 15, 20, 25]).filter((n) => n >= 1 && n <= 28);
  const gridSearch = args.includes('--grid-search');
  const gridSearchPerMetric = args.includes('--grid-search-per-metric');
  const coldStart = args.includes('--cold-start');
  const windowSearch = args.includes('--window-search');
  const runrateCheck = args.includes('--runrate-check');
  return { org, storeFilter, checkpoints, gridSearch, gridSearchPerMetric, coldStart, windowSearch, runrateCheck };
}

async function firstSaleDates(storeIds: string[]): Promise<Map<string, string>> {
  const res = await query(
    `SELECT store_id, MIN(sale_date)::text as d FROM sales
     WHERE store_id = ANY($1::text[]) AND (sim>0 OR mnp>0 OR pa>0 OR combo>0)
     GROUP BY store_id`,
    [storeIds]
  );
  return new Map(res.rows.map((r: any) => [r.store_id, r.d]));
}

async function listStores(org: string, storeFilter?: string): Promise<{ id: string; name: string }[]> {
  if (storeFilter) {
    const res = await query(`SELECT id, COALESCE(display_name, name) as name FROM stores WHERE id = $1`, [storeFilter]);
    return res.rows;
  }
  const res = await query(`SELECT id, COALESCE(display_name, name) as name FROM stores WHERE COALESCE(is_active,true)=true`);
  return res.rows;
}

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

function monthStartsInRange(from: string, toExclusive: string): string[] {
  const out: string[] = [];
  const cursor = new Date(from.slice(0, 7) + '-01T12:00:00');
  const end = new Date(toExclusive + 'T12:00:00');
  while (cursor < end) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

function lastDayOfMonth(monthStart: string): string {
  const d = new Date(monthStart + 'T12:00:00');
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return d.toISOString().slice(0, 10);
}

/** Один тестируемый чек-поинт (точка × месяц × день месяца), данные для
 * которого не зависят от гиперпараметров модели — считаются один раз,
 * прогон модели (runCheckpoint) вызывается на этих данных многократно
 * при grid-search без повторных запросов к БД. */
interface Checkpoint {
  storeId: string;
  monthStart: string;
  checkpointDay: number;
  windowRows: { dow: number; [k: string]: number | string }[];
  elapsedRows: { dow: number; [k: string]: number | string }[];
  factToDateByMetric: Record<string, number>;
  actualByMetric: Record<string, number>;
  remainingDows: { dow: number; step: number }[];
  daysHistory: number | null;
}

async function buildCheckpoints(stores: { id: string; name: string }[], checkpoints: number[]): Promise<{ points: Checkpoint[]; skipped: string[] }> {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const points: Checkpoint[] = [];
  const skipped: string[] = [];
  const firstSale = await firstSaleDates(stores.map((s) => s.id));

  for (const store of stores) {
    const rangeFrom = new Date(today);
    rangeFrom.setDate(rangeFrom.getDate() - 400);
    const series = await denseDailySeries(store.id, rangeFrom.toISOString().slice(0, 10), todayIso);
    const byDate = new Map(series.map((r) => [r.date, r]));

    const months = monthStartsInRange(series[0].date, todayIso);
    let storeHadPoint = false;
    for (const monthStart of months) {
      const monthEnd = lastDayOfMonth(monthStart);
      if (monthEnd >= todayIso) continue; // месяц должен быть завершён

      const actualByMetric: Record<string, number> = {};
      for (const m of METRICS) actualByMetric[m] = 0;
      let monthDaysPresent = 0;
      const dCursor = new Date(monthStart + 'T12:00:00');
      const dEnd = new Date(monthEnd + 'T12:00:00');
      dEnd.setDate(dEnd.getDate() + 1);
      while (dCursor < dEnd) {
        const key = dCursor.toISOString().slice(0, 10);
        const row = byDate.get(key);
        if (row) {
          monthDaysPresent++;
          for (const m of METRICS) actualByMetric[m] += Number(row[m]);
        }
        dCursor.setDate(dCursor.getDate() + 1);
      }
      if (!monthDaysPresent) continue;

      for (const cpDay of checkpoints) {
        const cpDate = new Date(monthStart + 'T12:00:00');
        cpDate.setDate(cpDate.getDate() + cpDay - 1);
        const cpIso = cpDate.toISOString().slice(0, 10);
        if (cpIso >= monthEnd) continue;

        const windowEnd = cpDate;
        const windowStart = new Date(windowEnd);
        windowStart.setDate(windowStart.getDate() - WINDOW_DAYS);
        const windowRows: { dow: number; [k: string]: number | string }[] = [];
        const wc = new Date(windowStart);
        let haveFullWindow = true;
        while (wc < windowEnd) {
          const key = wc.toISOString().slice(0, 10);
          const r = byDate.get(key);
          if (!r) haveFullWindow = false;
          windowRows.push(r || { date: key, dow: wc.getDay(), sim: 0, mnp: 0, pa: 0, combo: 0 });
          wc.setDate(wc.getDate() + 1);
        }
        if (!haveFullWindow) continue;

        const factToDateByMetric: Record<string, number> = {};
        for (const m of METRICS) factToDateByMetric[m] = 0;
        const elapsedRows: { dow: number; [k: string]: number | string }[] = [];
        const fc = new Date(monthStart + 'T12:00:00');
        const fEnd = new Date(cpIso + 'T12:00:00');
        fEnd.setDate(fEnd.getDate() + 1);
        while (fc < fEnd) {
          const key = fc.toISOString().slice(0, 10);
          const r = byDate.get(key);
          if (r) for (const m of METRICS) factToDateByMetric[m] += Number(r[m]);
          elapsedRows.push(r || { date: key, dow: fc.getDay(), sim: 0, mnp: 0, pa: 0, combo: 0 });
          fc.setDate(fc.getDate() + 1);
        }

        const remainingDows: { dow: number; step: number }[] = [];
        const rc = new Date(cpIso + 'T12:00:00');
        rc.setDate(rc.getDate() + 1);
        const rEnd = new Date(monthEnd + 'T12:00:00');
        rEnd.setDate(rEnd.getDate() + 1);
        let step = 1;
        while (rc < rEnd) {
          remainingDows.push({ dow: rc.getDay(), step: step++ });
          rc.setDate(rc.getDate() + 1);
        }

        const firstSaleIso = firstSale.get(store.id);
        const daysHistory = firstSaleIso
          ? Math.round((cpDate.getTime() - new Date(firstSaleIso + 'T12:00:00').getTime()) / 86400000)
          : null;

        points.push({ storeId: store.id, monthStart, checkpointDay: cpDay, windowRows, elapsedRows, factToDateByMetric, actualByMetric, remainingDows, daysHistory });
        storeHadPoint = true;
      }
    }
    if (!storeHadPoint) skipped.push(store.id);
  }

  return { points, skipped };
}

interface ResultRow {
  storeId: string;
  monthStart: string;
  checkpointDay: number;
  metric: string;
  predictedTotal: number;
  actualTotal: number;
  daysHistory: number | null;
}

interface Params {
  alpha: number;
  beta: number;
  phi: number;
  shrinkK: number;
}

function runModel(points: Checkpoint[], params: Params, onlyMetric?: (typeof METRICS)[number]): ResultRow[] {
  const results: ResultRow[] = [];
  for (const cp of points) {
    for (const m of METRICS) {
      if (onlyMetric && m !== onlyMetric) continue;
      const model = buildSesModel(
        cp.windowRows.map((r) => ({ dow: r.dow, value: Number(r[m]) })),
        params.alpha,
        params.shrinkK,
        params.beta,
        params.phi
      );
      let remainingForecast = 0;
      for (const rd of cp.remainingDows) remainingForecast += projectDay(model, rd.dow, rd.step);
      results.push({
        storeId: cp.storeId,
        monthStart: cp.monthStart,
        checkpointDay: cp.checkpointDay,
        metric: m,
        predictedTotal: cp.factToDateByMetric[m] + remainingForecast,
        actualTotal: cp.actualByMetric[m],
        daysHistory: cp.daysHistory
      });
    }
  }
  return results;
}

interface Acc {
  n: number;
  sumAbsErr: number;
  sumErr: number;
  sumSmape: number;
  sumActual: number;
}

function aggregateByMetricCheckpoint(results: ResultRow[]): Map<string, Acc> {
  const byMetricCp = new Map<string, Acc>();
  for (const r of results) {
    const key = `${r.metric}|${r.checkpointDay}`;
    const acc = byMetricCp.get(key) || { n: 0, sumAbsErr: 0, sumErr: 0, sumSmape: 0, sumActual: 0 };
    const err = r.predictedTotal - r.actualTotal;
    acc.n++;
    acc.sumAbsErr += Math.abs(err);
    acc.sumErr += err;
    const denom = Math.abs(r.predictedTotal) + Math.abs(r.actualTotal);
    acc.sumSmape += denom === 0 ? 0 : (2 * Math.abs(err)) / denom;
    acc.sumActual += r.actualTotal;
    byMetricCp.set(key, acc);
  }
  return byMetricCp;
}

/** Средневзвешенная SMAPE (%) по всем метрикам/чек-поинтам — единственный
 * скаляр, по которому ранжируются комбинации гиперпараметров в grid-search. */
function overallSmape(results: ResultRow[]): number {
  let sumSmape = 0;
  let n = 0;
  for (const r of results) {
    const err = r.predictedTotal - r.actualTotal;
    const denom = Math.abs(r.predictedTotal) + Math.abs(r.actualTotal);
    sumSmape += denom === 0 ? 0 : (2 * Math.abs(err)) / denom;
    n++;
  }
  return n ? (sumSmape / n) * 100 : Infinity;
}

function report(results: ResultRow[], checkpoints: number[]) {
  const byMetricCp = aggregateByMetricCheckpoint(results);
  for (const m of METRICS) {
    console.log(`=== ${m} ===`);
    for (const cp of checkpoints) {
      const acc = byMetricCp.get(`${m}|${cp}`);
      if (!acc) continue;
      const mae = acc.sumAbsErr / acc.n;
      const bias = acc.sumErr / acc.n;
      const smape = (acc.sumSmape / acc.n) * 100;
      const avgActual = acc.sumActual / acc.n;
      console.log(
        `  день ${String(cp).padStart(2)}: n=${acc.n}  MAE=${mae.toFixed(1)}  bias=${bias >= 0 ? '+' : ''}${bias.toFixed(1)}  ` +
        `SMAPE=${smape.toFixed(1)}%  (средний факт месяца=${avgActual.toFixed(1)})`
      );
    }
    console.log('');
  }
}

function coldStartReport(results: ResultRow[]) {
  const buckets: { label: string; test: (d: number | null) => boolean }[] = [
    { label: '< 60 дней истории', test: (d) => d !== null && d < 60 },
    { label: '60-119 дней истории', test: (d) => d !== null && d >= 60 && d < 120 },
    { label: '120-249 дней истории', test: (d) => d !== null && d >= 120 && d < 250 },
    { label: '>= 250 дней истории (зрелые)', test: (d) => d !== null && d >= 250 },
    { label: 'неизвестно (нет ни одной продажи)', test: (d) => d === null }
  ];
  console.log('Разбивка точности по объёму реальной истории точки на дату чек-поинта:\n');
  for (const b of buckets) {
    const subset = results.filter((r) => b.test(r.daysHistory));
    if (!subset.length) continue;
    const smape = overallSmape(subset);
    const distinctStores = new Set(subset.map((r) => r.storeId)).size;
    console.log(`  ${b.label}: n=${subset.length} (${distinctStores} точек)  SMAPE=${smape.toFixed(2)}%`);
  }
}

/** Прогон одной точки-чек-поинта с прогнозом = блендом СЕС-модели и
 * "run-rate" (линейная экстраполяция пейса: factToDate * daysInMonth/checkpointDay).
 * weight=1 — чистый SES (как runModel), weight=0 — чистый run-rate. */
function runBlend(points: Checkpoint[], params: Params, weight: number): ResultRow[] {
  const results: ResultRow[] = [];
  for (const cp of points) {
    const daysInMonth = cp.checkpointDay + cp.remainingDows.length;
    for (const m of METRICS) {
      const model = buildSesModel(
        cp.windowRows.map((r) => ({ dow: r.dow, value: Number(r[m]) })),
        params.alpha,
        params.shrinkK,
        params.beta,
        params.phi
      );
      let remainingForecast = 0;
      for (const rd of cp.remainingDows) remainingForecast += projectDay(model, rd.dow, rd.step);
      const sesTotal = cp.factToDateByMetric[m] + remainingForecast;
      const runRateTotal = cp.factToDateByMetric[m] * (daysInMonth / cp.checkpointDay);
      const predictedTotal = weight * sesTotal + (1 - weight) * runRateTotal;
      results.push({
        storeId: cp.storeId,
        monthStart: cp.monthStart,
        checkpointDay: cp.checkpointDay,
        metric: m,
        predictedTotal,
        actualTotal: cp.actualByMetric[m],
        daysHistory: cp.daysHistory
      });
    }
  }
  return results;
}

async function main() {
  const { org, storeFilter, checkpoints, gridSearch, gridSearchPerMetric, coldStart, windowSearch, runrateCheck } = parseArgs();
  const stores = await listStores(org, storeFilter);
  if (!stores.length) {
    console.log('Точек не найдено.');
    return;
  }

  const { points, skipped } = await buildCheckpoints(stores, checkpoints);
  if (!points.length) {
    console.log('Нет ни одной контрольной точки с достаточной историей (нужно >=120 дней данных ДО контрольной даты внутри завершённого месяца).');
    if (skipped.length) console.log('Точки без результата:', skipped.join(', '));
    return;
  }

  const CURRENT_PARAMS: Params = { alpha: 0.3, beta: 0.05, phi: 0.9, shrinkK: 7 };

  if (process.argv.includes('--store-bias-check')) {
    // Не другая формула пейса, а принципиально другой класс поправки:
    // калибровка предсказания к систематическому смещению КОНКРЕТНОЙ
    // точки по конкретной метрике, а не общей формулой на всю сеть.
    // Ratio считается leave-one-out (без текущего чек-поинта) — иначе
    // это подгонка на тех же данных, на которых меряем, а не честная
    // проверка.
    const base = runBlend(points, CURRENT_PARAMS, 0);
    const byKey = new Map<string, ResultRow[]>();
    for (const r of base) {
      const key = `${r.storeId}|${r.metric}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(r);
    }
    for (const clamp of [1, 1.2, 1.5, 2, 3]) {
      const corrected: ResultRow[] = [];
      for (const r of base) {
        const key = `${r.storeId}|${r.metric}`;
        const siblings = byKey.get(key)!.filter((s) => s !== r);
        let ratioSum = 0, ratioN = 0;
        for (const s of siblings) {
          if (s.predictedTotal <= 0.01) continue;
          ratioSum += s.actualTotal / s.predictedTotal;
          ratioN++;
        }
        const rawRatio = ratioN >= 3 ? ratioSum / ratioN : 1;
        const ratio = Math.min(clamp, Math.max(1 / clamp, rawRatio));
        corrected.push({ ...r, predictedTotal: r.predictedTotal * ratio });
      }
      console.log(`  clamp=±${clamp}×: итого SMAPE=${overallSmape(corrected).toFixed(2)}%`);
    }
    console.log(`  без поправки (run-rate): итого SMAPE=${overallSmape(base).toFixed(2)}%`);
    return;
  }

  if (process.argv.includes('--median-pace-check')) {
    // Медианный, а не средний, дневной пейс — устойчивее к одному
    // "выстрелившему" дню без искусственного клэмпа (winsorizing уже
    // проверен и провалился, это другой механизм устойчивости).
    const results: ResultRow[] = [];
    for (const cp of points) {
      for (const m of METRICS) {
        const tail = cp.elapsedRows.map((r) => Number(r[m])).sort((a, b) => a - b);
        const mid = Math.floor(tail.length / 2);
        const median = tail.length % 2 ? tail[mid] : (tail[mid - 1] + tail[mid]) / 2;
        const predictedTotal = cp.factToDateByMetric[m] + median * cp.remainingDows.length;
        results.push({ storeId: cp.storeId, monthStart: cp.monthStart, checkpointDay: cp.checkpointDay, metric: m, predictedTotal, actualTotal: cp.actualByMetric[m], daysHistory: cp.daysHistory });
      }
    }
    console.log(`Медианный пейс: итого SMAPE=${overallSmape(results).toFixed(2)}%`);
    for (const cp of checkpoints) console.log(`  д${cp}: SMAPE=${overallSmape(results.filter((r) => r.checkpointDay === cp)).toFixed(2)}%`);
    return;
  }

  if (process.argv.includes('--weighted-pace-check')) {
    // Экспоненциально взвешенный пейс (EWMA по дням с начала месяца) —
    // более "сложный" метод, чем плоское среднее: недавние дни весят
    // больше давних, реагирует на внутримесячный тренд/разгон продаж,
    // которое плоское среднее игнорирует.
    for (const decay of [1, 0.98, 0.95, 0.92, 0.9, 0.88, 0.85, 0.8]) {
      const results: ResultRow[] = [];
      for (const cp of points) {
        for (const m of METRICS) {
          const tail = cp.elapsedRows.map((r) => Number(r[m]));
          let wSum = 0, vwSum = 0, w = 1;
          for (let i = tail.length - 1; i >= 0; i--) {
            vwSum += w * tail[i];
            wSum += w;
            w *= decay;
          }
          const pace = wSum > 0 ? vwSum / wSum : 0;
          const predictedTotal = cp.factToDateByMetric[m] + pace * cp.remainingDows.length;
          results.push({ storeId: cp.storeId, monthStart: cp.monthStart, checkpointDay: cp.checkpointDay, metric: m, predictedTotal, actualTotal: cp.actualByMetric[m], daysHistory: cp.daysHistory });
        }
      }
      const byCp = checkpoints.map((cp) => `д${cp}=${overallSmape(results.filter((r) => r.checkpointDay === cp)).toFixed(2)}%`).join(' ');
      console.log(`  decay=${decay} (1=обычное среднее): итого SMAPE=${overallSmape(results).toFixed(2)}%  [${byCp}]`);
    }
    return;
  }

  if (process.argv.includes('--ensemble-check')) {
    // Ансамбль: усредняем прогнозы НЕСКОЛЬКИХ разных методов (run-rate,
    // EWMA-пейс, SES-сумма) вместо выбора одного лучшего — классическая
    // идея ансамблирования работает, когда модели ошибаются по-разному
    // (некоррелированные ошибки). Проверяем, даёт ли усреднение выигрыш
    // здесь, где отдельные методы уже пересчитаны на одних и тех же данных.
    const runRate: ResultRow[] = [];
    const ewma: ResultRow[] = [];
    const sesSum: ResultRow[] = [];
    for (const cp of points) {
      const model = new Map(METRICS.map((m) => [
        m,
        buildSesModel(cp.windowRows.map((r) => ({ dow: r.dow, value: Number(r[m]) })), CURRENT_PARAMS.alpha, CURRENT_PARAMS.shrinkK, CURRENT_PARAMS.beta, CURRENT_PARAMS.phi)
      ]));
      for (const m of METRICS) {
        const tail = cp.elapsedRows.map((r) => Number(r[m]));
        const meanPace = cp.factToDateByMetric[m] / (tail.length || 1);
        let wSum = 0, vwSum = 0, w = 1;
        for (let i = tail.length - 1; i >= 0; i--) { vwSum += w * tail[i]; wSum += w; w *= 0.9; }
        const ewmaPace = wSum > 0 ? vwSum / wSum : 0;
        let sesRemaining = 0;
        for (const rd of cp.remainingDows) sesRemaining += projectDay(model.get(m)!, rd.dow, rd.step);

        const meta = { storeId: cp.storeId, monthStart: cp.monthStart, checkpointDay: cp.checkpointDay, metric: m, actualTotal: cp.actualByMetric[m], daysHistory: cp.daysHistory };
        runRate.push({ ...meta, predictedTotal: cp.factToDateByMetric[m] + meanPace * cp.remainingDows.length });
        ewma.push({ ...meta, predictedTotal: cp.factToDateByMetric[m] + ewmaPace * cp.remainingDows.length });
        sesSum.push({ ...meta, predictedTotal: cp.factToDateByMetric[m] + sesRemaining });
      }
    }
    console.log(`  run-rate соло: ${overallSmape(runRate).toFixed(2)}%`);
    console.log(`  EWMA(0.9) соло: ${overallSmape(ewma).toFixed(2)}%`);
    console.log(`  SES-сумма соло: ${overallSmape(sesSum).toFixed(2)}%`);
    for (const [label, weights] of [
      ['равный вес run-rate+EWMA+SES (1/3 каждому)', [1 / 3, 1 / 3, 1 / 3]],
      ['run-rate+EWMA пополам', [0.5, 0.5, 0]],
      ['run-rate 0.7 + EWMA 0.3', [0.7, 0.3, 0]]
    ] as [string, number[]][]) {
      const blended: ResultRow[] = runRate.map((r, i) => ({
        ...r,
        predictedTotal: weights[0] * r.predictedTotal + weights[1] * ewma[i].predictedTotal + weights[2] * sesSum[i].predictedTotal
      }));
      console.log(`  ${label}: ${overallSmape(blended).toFixed(2)}%`);
    }
    return;
  }

  if (process.argv.includes('--anomaly-exclude-pace-check')) {
    // Не клэмп (winsorizing уже провален), а ТОЧЕЧНОЕ исключение дней,
    // помеченных как аномалия тем же принципом, что core/alerts/anomaly.ts
    // (Z_THRESHOLD=2 на отклонении факта от SES-сезонного уровня) — эти дни
    // остаются в factToDate (реальный факт месяца не трогаем), но не
    // участвуют в расчёте пейса для ОСТАВШИХСЯ дней.
    const results: ResultRow[] = [];
    let totalExcluded = 0, totalElapsed = 0;
    for (const cp of points) {
      for (const m of METRICS) {
        const model = buildSesModel(
          cp.windowRows.map((r) => ({ dow: r.dow, value: Number(r[m]) })),
          CURRENT_PARAMS.alpha, CURRENT_PARAMS.shrinkK, CURRENT_PARAMS.beta, CURRENT_PARAMS.phi
        );
        const residuals = cp.elapsedRows.map((r) => {
          const expected = model.level * (model.seasonal[r.dow] ?? 1);
          return Number(r[m]) - expected;
        });
        const meanResid = residuals.reduce((s, v) => s + v, 0) / (residuals.length || 1);
        const variance = residuals.reduce((s, v) => s + (v - meanResid) ** 2, 0) / (residuals.length || 1);
        const stdev = Math.sqrt(variance);
        totalElapsed += cp.elapsedRows.length;
        const kept: number[] = [];
        cp.elapsedRows.forEach((r, i) => {
          const z = stdev > 0.01 ? residuals[i] / stdev : 0;
          if (Math.abs(z) >= 2) { totalExcluded++; return; }
          kept.push(Number(r[m]));
        });
        const pace = kept.length ? kept.reduce((s, v) => s + v, 0) / kept.length : cp.factToDateByMetric[m] / cp.checkpointDay;
        const predictedTotal = cp.factToDateByMetric[m] + pace * cp.remainingDows.length;
        results.push({ storeId: cp.storeId, monthStart: cp.monthStart, checkpointDay: cp.checkpointDay, metric: m, predictedTotal, actualTotal: cp.actualByMetric[m], daysHistory: cp.daysHistory });
      }
    }
    console.log(`Исключено дней как аномалия: ${totalExcluded} из ${totalElapsed} (${((totalExcluded / totalElapsed) * 100).toFixed(1)}%)`);
    console.log(`Пейс без аномальных дней: итого SMAPE=${overallSmape(results).toFixed(2)}%`);
    for (const cp of checkpoints) console.log(`  д${cp}: SMAPE=${overallSmape(results.filter((r) => r.checkpointDay === cp)).toFixed(2)}%`);
    return;
  }

  if (process.argv.includes('--dow-direct-pace-check')) {
    // Пейс по дню недели напрямую, без SES: для каждого оставшегося дня
    // берём среднее факта ИМЕННО этого дня недели за прошедшую часть месяца
    // (не общий пейс с сезонной поправкой через SES-модель, как в уже
    // проверенной "поправке на состав дня недели" — там сезонность бралась
    // из SES, здесь вообще без SES).
    const results: ResultRow[] = [];
    for (const cp of points) {
      for (const m of METRICS) {
        const byDow = new Map<number, number[]>();
        for (const r of cp.elapsedRows) {
          const dow = Number(r.dow);
          if (!byDow.has(dow)) byDow.set(dow, []);
          byDow.get(dow)!.push(Number(r[m]));
        }
        const overallPace = cp.factToDateByMetric[m] / cp.checkpointDay;
        let sum = 0;
        for (const rd of cp.remainingDows) {
          const vals = byDow.get(rd.dow);
          const dowAvg = vals && vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : overallPace;
          sum += dowAvg;
        }
        const predictedTotal = cp.factToDateByMetric[m] + sum;
        results.push({ storeId: cp.storeId, monthStart: cp.monthStart, checkpointDay: cp.checkpointDay, metric: m, predictedTotal, actualTotal: cp.actualByMetric[m], daysHistory: cp.daysHistory });
      }
    }
    console.log(`Прямой пейс по дню недели (без SES): итого SMAPE=${overallSmape(results).toFixed(2)}%`);
    for (const cp of checkpoints) console.log(`  д${cp}: SMAPE=${overallSmape(results.filter((r) => r.checkpointDay === cp)).toFixed(2)}%`);
    return;
  }

  if (process.argv.includes('--network-factor-check')) {
    // Сетевой день-фактор: если за последние 7 прошедших дней ВСЯ сеть
    // (не одна точка, в отличие от уже проверенного --store-bias-check)
    // шла выше/ниже своего обычного пейса — предполагаем, что это
    // сохранится на оставшиеся дни, и корректируем прогноз КАЖДОЙ точки
    // общим сетевым множителем.
    const byGroup = new Map<string, Checkpoint[]>();
    for (const cp of points) {
      const key = `${cp.monthStart}|${cp.checkpointDay}`;
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key)!.push(cp);
    }
    const results: ResultRow[] = [];
    for (const [, group] of byGroup) {
      for (const m of METRICS) {
        const ratios: number[] = [];
        for (const cp of group) {
          const ownPace = cp.factToDateByMetric[m] / cp.checkpointDay;
          if (ownPace <= 0.01) continue;
          const tailK = cp.elapsedRows.slice(-Math.min(7, cp.elapsedRows.length));
          for (const r of tailK) ratios.push(Number(r[m]) / ownPace);
        }
        const networkFactor = ratios.length ? ratios.reduce((s, v) => s + v, 0) / ratios.length : 1;
        for (const cp of group) {
          const ownPace = cp.factToDateByMetric[m] / cp.checkpointDay;
          const predictedTotal = cp.factToDateByMetric[m] + ownPace * networkFactor * cp.remainingDows.length;
          results.push({ storeId: cp.storeId, monthStart: cp.monthStart, checkpointDay: cp.checkpointDay, metric: m, predictedTotal, actualTotal: cp.actualByMetric[m], daysHistory: cp.daysHistory });
        }
      }
    }
    console.log(`Сетевой день-фактор (последние 7 дней, вся сеть): итого SMAPE=${overallSmape(results).toFixed(2)}%`);
    for (const cp of checkpoints) console.log(`  д${cp}: SMAPE=${overallSmape(results.filter((r) => r.checkpointDay === cp)).toFixed(2)}%`);
    return;
  }

  if (process.argv.includes('--interval-check')) {
    // Не про точность прогноза, а про честность доверительного интервала:
    // точечный прогноз в проде уже run-rate, но stdev всё ещё считается по
    // старой SES-модели (projectDayStdev). Сравниваем ЭМПИРИЧЕСКОЕ покрытие
    // интервала predictedTotal±1σ у трёх вариантов stdev: (a) текущий
    // прод-вариант (SES projectDayStdev, суммированный по дисперсии), (b)
    // stdev по разбросу прошедших дней месяца, масштабированный на
    // remainingDays (согласовано с run-rate точечным прогнозом), (c)
    // bootstrap — многократный ресэмплинг прошедших дней с возвратом,
    // сумма remainingDays.length значений, stdev по эмпирическому
    // распределению. При z=1 и нормальном распределении ожидаемое покрытие
    // ~68% — если она сильно ниже, интервал занижен (ложная уверенность),
    // если сильно выше — завышен (бесполезно широкий).
    let coverA = 0, coverB = 0, coverC = 0, total = 0;
    for (const cp of points) {
      for (const m of METRICS) {
        const model = buildSesModel(
          cp.windowRows.map((r) => ({ dow: r.dow, value: Number(r[m]) })),
          CURRENT_PARAMS.alpha, CURRENT_PARAMS.shrinkK, CURRENT_PARAMS.beta, CURRENT_PARAMS.phi
        );
        let varianceSumA = 0;
        for (const rd of cp.remainingDows) {
          const sd = projectDayStdev(model, rd.dow, rd.step);
          varianceSumA += sd * sd;
        }
        const stdevA = Math.sqrt(varianceSumA);

        const dailyVals = cp.elapsedRows.map((r) => Number(r[m]));
        const meanDaily = dailyVals.reduce((s, v) => s + v, 0) / (dailyVals.length || 1);
        const varDaily = dailyVals.reduce((s, v) => s + (v - meanDaily) ** 2, 0) / (dailyVals.length || 1);
        const stdevB = Math.sqrt(varDaily * cp.remainingDows.length);

        let bootSumSq = 0;
        const BOOT_N = 200;
        const boots: number[] = [];
        for (let b = 0; b < BOOT_N; b++) {
          let sum = 0;
          for (let i = 0; i < cp.remainingDows.length; i++) {
            sum += dailyVals[Math.floor(Math.random() * dailyVals.length)] ?? 0;
          }
          boots.push(sum);
        }
        const bootMean = boots.reduce((s, v) => s + v, 0) / BOOT_N;
        bootSumSq = boots.reduce((s, v) => s + (v - bootMean) ** 2, 0) / BOOT_N;
        const stdevC = Math.sqrt(bootSumSq);

        const pace = cp.factToDateByMetric[m] / cp.checkpointDay;
        const predictedTotal = cp.factToDateByMetric[m] + pace * cp.remainingDows.length;
        const actual = cp.actualByMetric[m];
        total++;
        if (Math.abs(actual - predictedTotal) <= stdevA) coverA++;
        if (Math.abs(actual - predictedTotal) <= stdevB) coverB++;
        if (Math.abs(actual - predictedTotal) <= stdevC) coverC++;
      }
    }
    console.log(`Покрытие интервала ±1σ (ожидаемо ~68% при нормальности), n=${total}:`);
    console.log(`  (a) текущий прод — SES projectDayStdev: ${((coverA / total) * 100).toFixed(1)}%`);
    console.log(`  (b) run-rate — разброс прошедших дней × remainingDays: ${((coverB / total) * 100).toFixed(1)}%`);
    console.log(`  (c) bootstrap ресэмплинг прошедших дней: ${((coverC / total) * 100).toFixed(1)}%`);
    return;
  }

  if (process.argv.includes('--weighted-metric-check')) {
    // Не про точность, а про то, меняется ли "лучший метод", если взвесить
    // ошибку иначе — например, сильнее штрафовать ранние чек-поинты (д5/д10,
    // где решения по плану принимаются раньше и стоимость ошибки для
    // бизнеса выше), а не усреднять все чек-поинты поровну, как в
    // overallSmape().
    function weightedSmape(results: ResultRow[], weightFn: (cpDay: number) => number): number {
      let num = 0, den = 0;
      for (const r of results) {
        const w = weightFn(r.checkpointDay);
        const denom = Math.abs(r.predictedTotal) + Math.abs(r.actualTotal);
        const smape = denom === 0 ? 0 : (2 * Math.abs(r.predictedTotal - r.actualTotal)) / denom;
        num += w * smape;
        den += w;
      }
      return (num / (den || 1)) * 100;
    }
    const runRate = runBlend(points, CURRENT_PARAMS, 0);
    const ewma: ResultRow[] = [];
    for (const cp of points) {
      for (const m of METRICS) {
        const tail = cp.elapsedRows.map((r) => Number(r[m]));
        let wSum = 0, vwSum = 0, w = 1;
        for (let i = tail.length - 1; i >= 0; i--) { vwSum += w * tail[i]; wSum += w; w *= 0.9; }
        const pace = wSum > 0 ? vwSum / wSum : 0;
        ewma.push({ storeId: cp.storeId, monthStart: cp.monthStart, checkpointDay: cp.checkpointDay, metric: m, predictedTotal: cp.factToDateByMetric[m] + pace * cp.remainingDows.length, actualTotal: cp.actualByMetric[m], daysHistory: cp.daysHistory });
      }
    }
    console.log('Равный вес чек-поинтам (обычная overallSmape):');
    console.log(`  run-rate: ${weightedSmape(runRate, () => 1).toFixed(2)}%   EWMA(0.9): ${weightedSmape(ewma, () => 1).toFixed(2)}%`);
    console.log('Вес 1/checkpointDay (ранние чек-поинты важнее):');
    console.log(`  run-rate: ${weightedSmape(runRate, (d) => 1 / d).toFixed(2)}%   EWMA(0.9): ${weightedSmape(ewma, (d) => 1 / d).toFixed(2)}%`);
    console.log('Вес checkpointDay (поздние чек-поинты важнее):');
    console.log(`  run-rate: ${weightedSmape(runRate, (d) => d).toFixed(2)}%   EWMA(0.9): ${weightedSmape(ewma, (d) => d).toFixed(2)}%`);
    return;
  }

  if (process.argv.includes('--trend-regression-check')) {
    // OLS-регрессия дневного значения на порядковый номер дня месяца —
    // экстраполирует ЛИНЕЙНЫЙ внутримесячный тренд вместо константного
    // пейса (даже сложнее EWMA: явно моделирует разгон/затухание продаж
    // по ходу месяца, а не просто взвешивает историю).
    const results: ResultRow[] = [];
    for (const cp of points) {
      for (const m of METRICS) {
        const tail = cp.elapsedRows.map((r) => Number(r[m]));
        const n = tail.length;
        const xs = Array.from({ length: n }, (_, i) => i + 1);
        const xMean = xs.reduce((a, b) => a + b, 0) / n;
        const yMean = tail.reduce((a, b) => a + b, 0) / n;
        let num = 0, den = 0;
        for (let i = 0; i < n; i++) {
          num += (xs[i] - xMean) * (tail[i] - yMean);
          den += (xs[i] - xMean) ** 2;
        }
        const slope = den > 0 ? num / den : 0;
        const intercept = yMean - slope * xMean;
        let sum = 0;
        for (let i = 0; i < cp.remainingDows.length; i++) {
          const x = n + i + 1;
          sum += Math.max(0, intercept + slope * x);
        }
        const predictedTotal = cp.factToDateByMetric[m] + sum;
        results.push({ storeId: cp.storeId, monthStart: cp.monthStart, checkpointDay: cp.checkpointDay, metric: m, predictedTotal, actualTotal: cp.actualByMetric[m], daysHistory: cp.daysHistory });
      }
    }
    console.log(`Линейная регрессия по дням месяца: итого SMAPE=${overallSmape(results).toFixed(2)}%`);
    for (const cp of checkpoints) console.log(`  д${cp}: SMAPE=${overallSmape(results.filter((r) => r.checkpointDay === cp)).toFixed(2)}%`);
    return;
  }

  if (runrateCheck) {
    console.log('Бленд SES-прогноза с run-rate (линейный пейс) экстраполяцией, по весу SES:\n');
    for (const w of [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0]) {
      const results = runBlend(points, CURRENT_PARAMS, w);
      const overall = overallSmape(results);
      const byCp = checkpoints.map((cp) => {
        const subset = results.filter((r) => r.checkpointDay === cp);
        return `д${cp}=${overallSmape(subset).toFixed(1)}%`;
      }).join(' ');
      console.log(`  weight(SES)=${w.toFixed(1)}: итого SMAPE=${overall.toFixed(2)}%  [${byCp}]`);
    }
    console.log('\nПо метрикам при weight(SES)=0 (чистый run-rate):');
    const pureRunRate = runBlend(points, CURRENT_PARAMS, 0);
    for (const m of METRICS) {
      console.log(`  ${m}: SMAPE=${overallSmape(pureRunRate.filter((r) => r.metric === m)).toFixed(2)}%`);
    }

    // Поправка на состав дней недели: если уже прошедшие дни месяца
    // случайно богаче/беднее "тяжёлыми" днями недели (сб/вс), чем остаток
    // месяца, пейс за прошедшие дни не репрезентативен для остатка.
    // Корректируем пейс отношением среднего seasonal[dow] остатка к
    // среднему seasonal[dow] прошедших дней — сам уровень (calibration к
    // факту) не трогаем, только форму.
    console.log('\nRun-rate с поправкой на состав дня недели (seasonal remaining/elapsed):');
    {
      const results: ResultRow[] = [];
      for (const cp of points) {
        const monthStartDate = new Date(cp.monthStart + 'T12:00:00');
        const elapsedDows: number[] = [];
        for (let d = 0; d < cp.checkpointDay; d++) {
          const dc = new Date(monthStartDate);
          dc.setDate(dc.getDate() + d);
          elapsedDows.push(dc.getDay());
        }
        for (const m of METRICS) {
          const model = buildSesModel(
            cp.windowRows.map((r) => ({ dow: r.dow, value: Number(r[m]) })),
            CURRENT_PARAMS.alpha, CURRENT_PARAMS.shrinkK, CURRENT_PARAMS.beta, CURRENT_PARAMS.phi
          );
          const avgSeasonalElapsed = elapsedDows.reduce((s, d) => s + (model.seasonal[d] ?? 1), 0) / elapsedDows.length;
          const avgSeasonalRemaining = cp.remainingDows.reduce((s, rd) => s + (model.seasonal[rd.dow] ?? 1), 0) / cp.remainingDows.length;
          const pace = cp.factToDateByMetric[m] / cp.checkpointDay;
          const correction = avgSeasonalElapsed > 0.01 ? avgSeasonalRemaining / avgSeasonalElapsed : 1;
          const predictedTotal = cp.factToDateByMetric[m] + pace * correction * cp.remainingDows.length;
          results.push({ storeId: cp.storeId, monthStart: cp.monthStart, checkpointDay: cp.checkpointDay, metric: m, predictedTotal, actualTotal: cp.actualByMetric[m], daysHistory: cp.daysHistory });
        }
      }
      for (const cp of checkpoints) {
        console.log(`  д${cp}: SMAPE=${overallSmape(results.filter((r) => r.checkpointDay === cp)).toFixed(2)}%`);
      }
      console.log(`  итого: SMAPE=${overallSmape(results).toFixed(2)}%`);
    }

    // Усечённый (winsorized) пейс: каждый день с начала месяца клэмпается
    // сверху перед усреднением — проверка, не тянет ли один "выстрелевший"
    // день (акция/крупная сделка) пейс вверх непропорционально его весу
    // в остатке месяца.
    console.log('\nRun-rate по winsorized факту (клэмп дня к N× среднего дневного факта до чек-поинта):');
    for (const capMult of [1.5, 2, 3, 5]) {
      const results: ResultRow[] = [];
      for (const cp of points) {
        for (const m of METRICS) {
          const tail = cp.elapsedRows.map((r) => Number(r[m]));
          const rawAvg = tail.reduce((s, v) => s + v, 0) / (tail.length || 1);
          const cap = rawAvg * capMult;
          const clamped = tail.map((v) => Math.min(v, cap));
          const pace = clamped.reduce((s, v) => s + v, 0) / (clamped.length || 1);
          const predictedTotal = cp.factToDateByMetric[m] + pace * cp.remainingDows.length;
          results.push({ storeId: cp.storeId, monthStart: cp.monthStart, checkpointDay: cp.checkpointDay, metric: m, predictedTotal, actualTotal: cp.actualByMetric[m], daysHistory: cp.daysHistory });
        }
      }
      console.log(`  cap=${capMult}×avg: итого SMAPE=${overallSmape(results).toFixed(2)}%`);
    }

    // Бленд пейса с фактическим ПРЕДЫДУЩИМ календарным месяцем той же точки
    // (не SES-уровнем, как в провалившемся k-эксперименте выше) — та же
    // идея байесовской усадки, но якорь — реально случившийся месяц, а не
    // сглаженная модель.
    console.log('\nБленд пейса с фактом предыдущего месяца (k псевдо-дней):');
    for (const k of [0, 1, 2, 3, 5]) {
      const results: ResultRow[] = [];
      for (const cp of points) {
        const prevMonthStart = new Date(cp.monthStart + 'T12:00:00');
        prevMonthStart.setMonth(prevMonthStart.getMonth() - 1);
        const prevMonthStartIso = prevMonthStart.toISOString().slice(0, 10);
        const prevRows = cp.windowRows.filter((r) => String(r.date) >= prevMonthStartIso && String(r.date) < cp.monthStart);
        for (const m of METRICS) {
          const prevMonthDailyAvg = prevRows.length
            ? prevRows.reduce((s, r) => s + Number(r[m]), 0) / prevRows.length
            : cp.factToDateByMetric[m] / cp.checkpointDay;
          const pace = (cp.factToDateByMetric[m] + k * prevMonthDailyAvg) / (cp.checkpointDay + k);
          const predictedTotal = cp.factToDateByMetric[m] + pace * cp.remainingDows.length;
          results.push({ storeId: cp.storeId, monthStart: cp.monthStart, checkpointDay: cp.checkpointDay, metric: m, predictedTotal, actualTotal: cp.actualByMetric[m], daysHistory: cp.daysHistory });
        }
      }
      const byCp = checkpoints.map((cp) => `д${cp}=${overallSmape(results.filter((r) => r.checkpointDay === cp)).toFixed(1)}%`).join(' ');
      console.log(`  k=${k}: итого SMAPE=${overallSmape(results).toFixed(2)}%  [${byCp}]`);
    }
    return;
  }

  if (windowSearch) {
    const originalWindow = WINDOW_DAYS;
    const candidates = [60, 90, 120, 150, 180, 240];
    // Скрипт тянет фиксированные 400 дней истории назад от сегодня — с
    // ростом WINDOW_DAYS часть старых чек-поинтов отсеивается уже не
    // нехваткой РЕАЛЬНОЙ истории точки, а тем, что окно упирается в границу
    // запроса к БД. Раздельное сравнение SMAPE по каждому window size на
    // СВОЁМ n было бы нечестным (разные подвыборки). Поэтому сначала строим
    // набор чек-поинтов на самом большом окне (самый строгий фильтр) и для
    // всех размеров окна считаем SMAPE только по этому общему пересечению.
    WINDOW_DAYS = Math.max(...candidates);
    const { points: strictPoints } = await buildCheckpoints(stores, checkpoints);
    const commonIds = new Set(strictPoints.map((p) => `${p.storeId}|${p.monthStart}|${p.checkpointDay}`));
    console.log(`Перебор WINDOW_DAYS (текущие ALPHA/BETA/PHI/SHRINK_K), общее пересечение чек-поинтов: n=${commonIds.size}\n`);

    for (const w of candidates) {
      WINDOW_DAYS = w;
      const { points: wPoints } = await buildCheckpoints(stores, checkpoints);
      const filtered = wPoints.filter((p) => commonIds.has(`${p.storeId}|${p.monthStart}|${p.checkpointDay}`));
      const smape = overallSmape(runModel(filtered, CURRENT_PARAMS));
      console.log(`  WINDOW_DAYS=${String(w).padStart(3)}: n=${filtered.length}  SMAPE=${smape.toFixed(2)}%`);
    }
    WINDOW_DAYS = originalWindow;
    return;
  }

  if (coldStart) {
    const results = runModel(points, CURRENT_PARAMS);
    coldStartReport(results);
    return;
  }

  if (gridSearch) {
    // Более широкая и мелкая сетка, чем первый проход (тот был 5×5×5×3,
    // грубо нашёл направление — тут уточняем вокруг него и за его границами).
    const alphas = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4];
    const betas = [0, 0.03, 0.05, 0.08, 0.12];
    const phis = [0.8, 0.85, 0.9, 0.95, 1];
    const shrinkKs = [10, 15, 20, 30, 50, 80];
    console.log(`Grid-search: ${alphas.length}×${betas.length}×${phis.length}×${shrinkKs.length} = ${alphas.length * betas.length * phis.length * shrinkKs.length} комбинаций, на ${points.length} чек-поинтах\n`);

    const scored: (Params & { smape: number })[] = [];
    for (const alpha of alphas) {
      for (const beta of betas) {
        for (const phi of phis) {
          for (const shrinkK of shrinkKs) {
            const results = runModel(points, { alpha, beta, phi, shrinkK });
            scored.push({ alpha, beta, phi, shrinkK, smape: overallSmape(results) });
            if (beta === 0) break; // phi не влияет, когда тренд выключен — не дублировать прогон
          }
        }
      }
    }
    scored.sort((a, b) => a.smape - b.smape);

    console.log('Топ-10 комбинаций по средней SMAPE:');
    for (const s of scored.slice(0, 10)) {
      console.log(`  alpha=${s.alpha}  beta=${s.beta}  phi=${s.phi}  shrinkK=${s.shrinkK}  → SMAPE=${s.smape.toFixed(2)}%`);
    }
    console.log(`\nТекущие константы в forecast.ts (alpha=${CURRENT_PARAMS.alpha}, beta=${CURRENT_PARAMS.beta}, phi=${CURRENT_PARAMS.phi}, shrinkK=${CURRENT_PARAMS.shrinkK}) дают SMAPE=` +
      `${overallSmape(runModel(points, CURRENT_PARAMS)).toFixed(2)}%`);
    return;
  }

  if (gridSearchPerMetric) {
    const alphas = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4];
    const shrinkKs = [3, 5, 7, 10, 15, 20];
    // beta=0 фиксирован по итогам общего grid-search выше (тренд не помогает).
    console.log(`Grid-search по метрикам отдельно: ${alphas.length}×${shrinkKs.length} комбинаций на метрику, beta=0 зафиксирован\n`);

    let combinedSmapeSum = 0;
    let combinedN = 0;
    for (const metric of METRICS) {
      let best: (Params & { smape: number }) | null = null;
      for (const alpha of alphas) {
        for (const shrinkK of shrinkKs) {
          const results = runModel(points, { alpha, beta: 0, phi: 0.9, shrinkK }, metric);
          const smape = overallSmape(results);
          if (!best || smape < best.smape) best = { alpha, beta: 0, phi: 0.9, shrinkK, smape };
        }
      }
      const currentResults = runModel(points, CURRENT_PARAMS, metric);
      const currentSmape = overallSmape(currentResults);
      console.log(
        `${metric}: лучшее alpha=${best!.alpha} shrinkK=${best!.shrinkK} → SMAPE=${best!.smape.toFixed(2)}%  ` +
        `(общие константы для этой метрики дают ${currentSmape.toFixed(2)}%)`
      );
      const bestResults = runModel(points, { alpha: best!.alpha, beta: 0, phi: 0.9, shrinkK: best!.shrinkK }, metric);
      combinedSmapeSum += bestResults.reduce((sum, r) => {
        const err = r.predictedTotal - r.actualTotal;
        const denom = Math.abs(r.predictedTotal) + Math.abs(r.actualTotal);
        return sum + (denom === 0 ? 0 : (2 * Math.abs(err)) / denom);
      }, 0);
      combinedN += bestResults.length;
    }
    console.log(`\nЕсли настроить alpha/shrinkK отдельно для каждой метрики: общая SMAPE = ${((combinedSmapeSum / combinedN) * 100).toFixed(2)}%`);
    console.log(`Общие константы на все метрики (текущие): SMAPE = ${overallSmape(runModel(points, CURRENT_PARAMS)).toFixed(2)}%`);
    return;
  }

  console.log(`Backtest месячного прогноза — контрольные точки: день ${checkpoints.join(', ')} месяца\n`);
  // Прод (supervisor.ts::forecastRemainingOfMonth) считает остаток месяца
  // run-rate'ом (weight(SES)=0), не суммой SES по дням — см. --runrate-check
  // и комментарий у forecastRemainingOfMonth. Report-режим измеряет то же,
  // что реально видит пользователь.
  const results = runBlend(points, CURRENT_PARAMS, 0);
  report(results, checkpoints);

  console.log(`Всего контрольных точек: ${points.length} (точка × месяц × чек-поинт)`);
  const distinctStoreMonths = new Set(points.map((p) => `${p.storeId}|${p.monthStart}`));
  console.log(`Из точка-месяцев: ${distinctStoreMonths.size}`);
  if (skipped.length) console.log(`Точки без результата (недостаточно истории): ${skipped.join(', ')}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
