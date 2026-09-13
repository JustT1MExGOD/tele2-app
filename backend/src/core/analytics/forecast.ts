import { todayMoscow } from '../../utils/date.js';
import * as repo from '../../data/repositories/forecast.js';

function num(v: any) {
  return Number(v) || 0;
}

// Тот же полный список, что METRICS в core/analytics/supervisor.ts —
// раньше здесь были только sim/mnp/pa/combo, остальные 11 метрик
// (phones/accessories/settings/... /hb) не прогнозировались вообще, хотя
// supervisor.ts::forecastRemainingOfMonth их уже считает для месячного
// прогноза. Единообразие ради дневного /forecast/:storeId и staffing hints.
const METRICS = [
  'sim', 'mnp', 'pa', 'combo', 'phones', 'accessories', 'settings',
  'insurance', 'wink', 'shpd', 'focus', 'credit_request', 'credit_issued',
  'plotter', 'hb'
] as const;
type Metric = (typeof METRICS)[number];

/**
 * Прогноз: экспоненциальное сглаживание с демпфированным линейным трендом
 * (Holt/Gardner damped-trend) × сезонная поправка на день недели с усадкой
 * (shrinkage) к нейтральной 1.0, пока по этому дню недели мало наблюдений.
 *
 * Раньше прогноз брал среднее только по ТОЧНО тому же дню недели за 8 недель —
 * с датасетом короче 8 недель (как сейчас, всего несколько дней истории)
 * подходящих точек нет вообще ни по одному дню, и прогноз всегда был 0.
 * Новая модель даёт осмысленное число с первого дня: без сезонной истории
 * поправка ~1.0 (просто продолжает сглаженный уровень), а по мере накопления
 * данных по каждому дню недели поправка сама уточняется.
 *
 * Тренд-компонента (Holt/damped-trend) добавлена в модель по гипотезе:
 * чистое SES без тренда систематически занижало итог месяца в начале
 * месяца (bias стабильно отрицательный, 6-9% SMAPE на 5-10 числе в
 * бэктесте `src/scripts/forecast-month-backtest.ts`). Тренд демпфирован
 * (phi<1, сумма phi+phi²+...+phiʰ вместо trend×h) — без демпфирования
 * линейный тренд, экстраполированный на 25+ дней вперёд (месячный
 * прогноз в начале месяца), мог бы уйти в отрыв от реальности
 * (Gardner & McKenzie damped-trend, стандартный приём для длинных
 * горизонтов).
 *
 * ALPHA/BETA/PHI/SHRINK_K подобраны grid-search'ем по 748 реальным
 * историческим чек-поинтам (`forecast:month-backtest --grid-search`), не
 * заданы на глаз.
 *
 * Первый проход (см. историю в git) перебирал SHRINK_K только в диапазоне
 * 10-80 и на нём BETA=0 (тренд выключен) выигрывал — вывод был "тренд
 * только шумит". Это оказалось артефактом диапазона: диагностика по
 * чек-поинтам (день 5/10 месяца) показала устойчивый отрицательный bias
 * именно на длинных горизонтах прогноза, который SHRINK_K≥10 маскирует
 * (обнуляя сезонность), а не устраняет. Повторный grid-search с SHRINK_K,
 * ограниченным безопасной зоной (≤7 — см. ограничение ниже), нашёл, что
 * BETA>0 внутри этой зоны даёт большой честный выигрыш: SMAPE месячного
 * прогноза 9.59% → 5.01% на актуальной истории (748 чек-поинтов,
 * 2026-09-12), без приближения к границе, ломающей anomaly-детектор.
 * Тренд остаётся демпфированным (PHI<1, сумма phi+phi²+...+phiʰ вместо
 * trend×h) — без демпфирования линейный тренд, экстраполированный на
 * 25+ дней вперёд (месячный прогноз в начале месяца), мог бы уйти в
 * отрыв от реальности (Gardner & McKenzie damped-trend, стандартный
 * приём для длинных горизонтов).
 *
 * SHRINK_K намеренно НЕ поднят выше 7, хотя более широкий grid-search по
 * этому же скрипту показывал дальнейший рост точности вплоть до
 * SHRINK_K=80: при SHRINK_K→∞ сезонная поправка по дню недели
 * вырождается в 1.0 для всех дней, т.е. "лучший" результат по месячному
 * SMAPE в этой зоне — это фактически модель БЕЗ поправки на день недели.
 * Проверено на практике: SHRINK_K=10 ломает
 * `tests/isolation/anomaly.test.ts` ("факт близко к типичному — алерт не
 * создаётся") — при 18 неделях плотной истории и чистом недельном
 * паттерне (целевой день стабильно вдвое выше буднего) модель с
 * SHRINK_K=10 недооценивает прогноз настолько, что обычный факт
 * ошибочно детектируется как аномалия. Прод-история ограничена 120
 * днями (~17 недель) — это ровно тот режим, в котором живут реальные
 * магазины, так что это не артефакт теста. SHRINK_K=7 — сознательный
 * компромисс, на одну ступень grid'а ниже 10 (шаг сетки: 3/5/7),
 * подтверждённый прогоном того же теста после смены констант (см.
 * `npx vitest run tests/isolation/anomaly.test.ts`), а не найденный
 * максимум по одной метрике.
 */
const ALPHA = 0.3; // вес свежих данных в сглаживании уровня
const BETA = 0.05; // вес свежих данных в сглаживании тренда
const PHI = 0.9; // демпфирование тренда на горизонте
const SHRINK_K = 7; // сколько наблюдений нужно дню недели, чтобы его поправка "перевесила" нейтральную

export interface SesModel {
  level: number;
  /** Сглаженный линейный тренд (ед./день) — применяется демпфированно, см. projectDay. */
  trend: number;
  /** Коэффициент демпфирования, с которым построена именно эта модель —
   * хранится на модели (не берётся из общего PHI), чтобы grid-search
   * (forecast:month-backtest --grid-search) мог перебирать phi и
   * projectDay всегда использовал тот же phi, что и buildSesModel. */
  phi: number;
  seasonal: Record<number, number>;
  /** Разброс (стандартное отклонение) ratio по дню недели — насколько
   * типично скачет факт вокруг seasonal[dow] в единицах ratio, не в
   * абсолютных числах. Используется для z-score в детекции аномалий
   * (services/anomaly.ts, 19.2) — forecastStore/forecastRemainingOfMonth
   * это поле не читают, только прогнозируют вперёд по seasonal. */
  spread: Record<number, number>;
  sampleCount: Record<number, number>;
}

/** phi + phi² + ... + phiʰ — демпфированная сумма шагов тренда до h включительно. */
function dampedTrendSum(phi: number, h: number): number {
  if (h <= 0) return 0;
  if (Math.abs(phi - 1) < 1e-9) return h;
  return (phi * (1 - phi ** h)) / (1 - phi);
}

/**
 * Числовая сердцевина прогноза — вынесена сюда из трёх мест, где раньше
 * жили три версии одного и того же метода (страница «Прогноз» точки,
 * месячный прогноз кабинета супервайзера, и до этой правки — третья,
 * упрощённая копия в BFQ). Вызывающий обязан сам заполнить пропущенные
 * дни явными нулями в `dailyValues` — без этого сглаженный уровень
 * никогда не видит реальный ноль и застревает на случайном высоком дне
 * (баг, найденный визуальной проверкой на денежных метриках: один
 * крупный чек и дальше тишина без нулей давал прогноз в 1700%+ плана).
 * cold-start берёт масштаб из среднего по всей истории (не из первого
 * дня — тот может быть случайным), плюс клэмп дневного ratio, чтобы один
 * экстремальный день не определял сезонный коэффициент дня недели.
 */
export function buildSesModel(
  dailyValues: { dow: number; value: number }[],
  alpha = ALPHA,
  shrinkK = SHRINK_K,
  beta = BETA,
  phi = PHI
): SesModel {
  if (!dailyValues.length) return { level: 0, trend: 0, phi, seasonal: {}, spread: {}, sampleCount: {} };
  const seriesMean = dailyValues.reduce((a, r) => a + r.value, 0) / dailyValues.length;
  const coldBaseline = seriesMean > 0.01 ? seriesMean : 1;
  let level = seriesMean;
  let trend = 0;
  const ratioSum: Record<number, number> = {};
  const ratioSumSq: Record<number, number> = {};
  const ratioCount: Record<number, number> = {};
  for (const r of dailyValues) {
    const baseline = level > 0.01 ? level : coldBaseline;
    const ratio = Math.min(10, r.value / baseline);
    ratioSum[r.dow] = (ratioSum[r.dow] || 0) + ratio;
    ratioSumSq[r.dow] = (ratioSumSq[r.dow] || 0) + ratio * ratio;
    ratioCount[r.dow] = (ratioCount[r.dow] || 0) + 1;
    const prevLevel = level;
    level = alpha * r.value + (1 - alpha) * (prevLevel + phi * trend);
    trend = beta * (level - prevLevel) + (1 - beta) * phi * trend;
  }
  const seasonal: Record<number, number> = {};
  const spread: Record<number, number> = {};
  for (let dow = 0; dow <= 6; dow++) {
    const cnt = ratioCount[dow] || 0;
    const raw = cnt ? ratioSum[dow] / cnt : 1;
    seasonal[dow] = (cnt * raw + shrinkK * 1) / (cnt + shrinkK);
    // Популяционное стандартное отклонение вокруг raw (не вокруг
    // seasonal — spread про реальный разброс наблюдений, усадка
    // seasonal тут ни при чём). Меньше 2 наблюдений — разброс неизвестен,
    // консервативный широкий пол вместо ложной уверенности в узком 0.
    if (cnt >= 2) {
      const variance = Math.max(0, ratioSumSq[dow] / cnt - raw * raw);
      spread[dow] = Math.sqrt(variance);
    } else {
      spread[dow] = 1;
    }
  }
  return { level, trend, phi, seasonal, spread, sampleCount: ratioCount };
}

/**
 * stepsAhead — на сколько дней вперёд от конца окна модели прогнозируем
 * (1 = следующий день сразу после окна). Тренд применяется демпфированно
 * через dampedTrendSum, а не level + trend*stepsAhead напрямую — иначе на
 * длинных горизонтах (конец месяца, до 27+ дней вперёд) линейный тренд
 * уводит прогноз в отрыв от реальности.
 */
export function projectDay(model: SesModel, dow: number, stepsAhead = 1): number {
  const trended = model.level + (model.trend ?? 0) * dampedTrendSum(model.phi ?? PHI, stepsAhead);
  return Math.max(0, trended * (model.seasonal[dow] ?? 1));
}

/** Ширина «типичного диапазона» в стандартных отклонениях вокруг
 * прогноза одного дня — 1σ, а не 2σ, как в anomaly.ts (Z_THRESHOLD=2 там
 * отвечает на другой вопрос: "это уже аномалия?"; здесь — "какой разброс
 * нормален?"). Экспортируется, чтобы вызывающий код (supervisor.ts) мог
 * складывать дисперсии нескольких дней тем же множителем. */
export const CONFIDENCE_Z = 1;

/** Абсолютное стандартное отклонение прогноза на конкретный день — та же
 * величина, что уже неявно считает anomaly.ts (level*spread, с полом
 * 20% от level, чтобы дни без истории по этому dow не давали ложно узкий
 * диапазон). Вынесено сюда, а не задублировано, чтобы confidence-интервал
 * и anomaly-порог всегда считались из одной формулы. */
export function projectDayStdev(model: SesModel, dow: number, stepsAhead = 1): number {
  const trended = model.level + (model.trend ?? 0) * dampedTrendSum(model.phi ?? PHI, stepsAhead);
  const spreadRatio = model.spread[dow] ?? 1;
  return Math.max(trended * spreadRatio, trended * 0.2, 0);
}

/** Прогноз одного дня вместе с «типичным диапазоном» (predicted ± CONFIDENCE_Z·σ,
 * снизу отрезано в 0 — отрицательных продаж не бывает). */
export function projectDayInterval(
  model: SesModel,
  dow: number,
  stepsAhead = 1
): { predicted: number; low: number; high: number } {
  const predicted = projectDay(model, dow, stepsAhead);
  const stdev = projectDayStdev(model, dow, stepsAhead);
  return {
    predicted,
    low: Math.max(0, predicted - CONFIDENCE_Z * stdev),
    high: predicted + CONFIDENCE_Z * stdev
  };
}

export async function forecastStore(storeId: string, fromDate: string, days = 7) {
  const histRows = await repo.findSalesHistory(storeId, fromDate);
  const byDate = new Map<string, any>();
  for (const r of histRows) byDate.set(String(r.d).slice(0, 10), r);

  // Заполняем все 120 дней окна, включая дни без единой продажи — те, что
  // GROUP BY sale_date молча пропускает. См. комментарий у buildSesModel.
  const rows: { dow: number; [k: string]: number }[] = [];
  const cursor = new Date(fromDate + 'T12:00:00');
  cursor.setDate(cursor.getDate() - 120);
  const end = new Date(fromDate + 'T12:00:00');
  while (cursor < end) {
    const key = cursor.toISOString().slice(0, 10);
    const r = byDate.get(key);
    const row: { dow: number; [k: string]: number } = { dow: cursor.getDay() };
    for (const m of METRICS) row[m] = r ? num(r[m]) : 0;
    rows.push(row);
    cursor.setDate(cursor.getDate() + 1);
  }

  const model: Record<Metric, SesModel> = {} as any;
  for (const m of METRICS) {
    model[m] = buildSesModel(rows.map((r) => ({ dow: r.dow, value: r[m] })));
  }

  const start = new Date(fromDate + 'T12:00:00');
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getDay();

    const predicted: Record<string, number> = {};
    const predictedLow: Record<string, number> = {};
    const predictedHigh: Record<string, number> = {};
    for (const m of METRICS) {
      const iv = projectDayInterval(model[m], dow, i + 1);
      predicted[m] = Math.round(iv.predicted);
      predictedLow[m] = Math.round(iv.low);
      predictedHigh[m] = Math.round(iv.high);
    }
    out.push({ date: iso, dow, predicted, predicted_low: predictedLow, predicted_high: predictedHigh, model: 'ses_dow_seasonal' });
  }
  // history_days — сколько дней окна реально содержали хотя бы одну
  // продажу (не длина заполненного нулями массива для модели) — тем же
  // смыслом, что раньше, страница «Прогноз» предупреждает при < 14.
  return { items: out, history_days: histRows.length };
}

/**
 * Подсказки «кого куда поставить» на неделю вперёд. Абсолютной меры
 * «сколько человек нужно точке» нет — прогноз в штуках SIM/MNP/ПА/Комбо,
 * не в человеко-часах. Поэтому эвристика относительная: нагрузка на
 * человека в графике (прогноз / headcount) сравнивается со средней по
 * сети на ту же дату — кто заметно выше среднего, тот кандидат на
 * усиление. Отдельно — точки, где на дату вообще никто не поставлен,
 * а прогноз ненулевой (самый очевидный случай).
 */
export async function getStaffingHints(days = 7, orgId = 'default') {
  const stores = await repo.listActiveStoresForOrg(orgId);
  if (!stores.length) return [];

  const start = todayMoscow();
  const forecasts: Record<string, Awaited<ReturnType<typeof forecastStore>>> = {};
  for (const s of stores) {
    forecasts[s.id] = await forecastStore(s.id, start, days);
  }

  const schedRows = await repo.findHeadcountByStoreDate(start, days);
  const headcountMap: Record<string, Record<string, number>> = {};
  for (const r of schedRows) {
    const d = String(r.d).slice(0, 10);
    (headcountMap[r.store_id] ||= {})[d] = num(r.headcount);
  }

  const dates = (forecasts[stores[0].id]?.items || []).map((it) => it.date);
  const hints: {
    date: string; store_id: string; store_name: string;
    severity: 'critical' | 'warn'; message: string;
  }[] = [];

  for (const date of dates) {
    let totalDemand = 0;
    let totalHeadcount = 0;
    const rows: { store_id: string; name: string; demand: number; headcount: number }[] = [];
    for (const s of stores) {
      const item = forecasts[s.id]?.items?.find((it) => it.date === date);
      const p = (item?.predicted || {}) as Record<string, number>;
      const demand = num(p.sim) + num(p.mnp) + num(p.pa) + num(p.combo);
      const headcount = headcountMap[s.id]?.[date] || 0;
      totalDemand += demand;
      totalHeadcount += headcount;
      rows.push({ store_id: s.id, name: s.name, demand, headcount });
    }
    const avgLoad = totalHeadcount > 0 ? totalDemand / totalHeadcount : 0;
    for (const r of rows) {
      if (r.headcount === 0 && r.demand > 0) {
        hints.push({
          date, store_id: r.store_id, store_name: r.name, severity: 'critical',
          message: `Никто не поставлен, а прогноз ~${Math.round(r.demand)} ед.`
        });
      } else if (r.headcount > 0 && avgLoad > 0) {
        const load = r.demand / r.headcount;
        if (load > avgLoad * 1.3) {
          hints.push({
            date, store_id: r.store_id, store_name: r.name, severity: 'warn',
            message: `Нагрузка на человека ~${Math.round(load)} против ${Math.round(avgLoad)} в среднем по сети`
          });
        }
      }
    }
  }

  hints.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
    return 0;
  });
  return hints.slice(0, 6);
}

/** Когорты новичков: выход на план за 2/4/8 недель */
export async function newbieCohorts(orgId = 'default') {
  // orgId был в сигнатуре и раньше, но нигде не читался в самом запросе —
  // функция всегда возвращала новичков всей БД, а не только своей сети.
  const emps = await repo.listNewHiresForOrg(orgId);

  const rows = [];
  for (const e of emps) {
    // created_at приходит как JS Date (timestamptz), а не строка — String(Date)
    // даёт "Tue Jul 28 2026 ..." вместо ISO, и .slice(0,10) резало "Tue Jul 28",
    // что дальше падало на invalid input syntax for type date в SQL ниже.
    const startRaw = e.hire_date || e.created_at;
    const start = startRaw instanceof Date ? startRaw.toISOString().slice(0, 10) : String(startRaw).slice(0, 10);
    const weeks = [2, 4, 8];
    const points: any = {};
    for (const w of weeks) {
      const cohort = await repo.sumCohortSales(e.id, start, w);
      points[`w${w}`] = {
        sim: num(cohort.sim),
        mnp: num(cohort.mnp)
      };
    }
    rows.push({
      employee_id: e.id,
      full_name: e.full_name,
      start,
      ...points
    });
  }
  return { items: rows };
}
