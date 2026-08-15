import { query } from '../db/index.js';
import { todayMoscow } from '../utils/date.js';

function num(v: any) {
  return Number(v) || 0;
}

const METRICS = ['sim', 'mnp', 'pa', 'combo'] as const;
type Metric = (typeof METRICS)[number];

/**
 * Прогноз: простое экспоненциальное сглаживание (уровень тренда) ×
 * сезонная поправка на день недели с усадкой (shrinkage) к нейтральной 1.0,
 * пока по этому дню недели мало наблюдений.
 *
 * Раньше прогноз брал среднее только по ТОЧНО тому же дню недели за 8 недель —
 * с датасетом короче 8 недель (как сейчас, всего несколько дней истории)
 * подходящих точек нет вообще ни по одному дню, и прогноз всегда был 0.
 * Новая модель даёт осмысленное число с первого дня: без сезонной истории
 * поправка ~1.0 (просто продолжает сглаженный уровень), а по мере накопления
 * данных по каждому дню недели поправка сама уточняется.
 */
const ALPHA = 0.3; // вес свежих данных в сглаживании уровня
const SHRINK_K = 3; // сколько наблюдений нужно дню недели, чтобы его поправка "перевесила" нейтральную

export interface SesModel {
  level: number;
  seasonal: Record<number, number>;
  /** Разброс (стандартное отклонение) ratio по дню недели — насколько
   * типично скачет факт вокруг seasonal[dow] в единицах ratio, не в
   * абсолютных числах. Используется для z-score в детекции аномалий
   * (services/anomaly.ts, 19.2) — forecastStore/forecastRemainingOfMonth
   * это поле не читают, только прогнозируют вперёд по seasonal. */
  spread: Record<number, number>;
  sampleCount: Record<number, number>;
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
  shrinkK = SHRINK_K
): SesModel {
  if (!dailyValues.length) return { level: 0, seasonal: {}, spread: {}, sampleCount: {} };
  const seriesMean = dailyValues.reduce((a, r) => a + r.value, 0) / dailyValues.length;
  const coldBaseline = seriesMean > 0.01 ? seriesMean : 1;
  let level = seriesMean;
  const ratioSum: Record<number, number> = {};
  const ratioSumSq: Record<number, number> = {};
  const ratioCount: Record<number, number> = {};
  for (const r of dailyValues) {
    const baseline = level > 0.01 ? level : coldBaseline;
    const ratio = Math.min(10, r.value / baseline);
    ratioSum[r.dow] = (ratioSum[r.dow] || 0) + ratio;
    ratioSumSq[r.dow] = (ratioSumSq[r.dow] || 0) + ratio * ratio;
    ratioCount[r.dow] = (ratioCount[r.dow] || 0) + 1;
    level = alpha * r.value + (1 - alpha) * level;
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
  return { level, seasonal, spread, sampleCount: ratioCount };
}

export function projectDay(model: SesModel, dow: number): number {
  return Math.max(0, model.level * (model.seasonal[dow] ?? 1));
}

export async function forecastStore(storeId: string, fromDate: string, days = 7) {
  const hist = await query(
    `SELECT sale_date::text as d,
            COALESCE(SUM(sim),0) sim, COALESCE(SUM(mnp),0) mnp,
            COALESCE(SUM(pa),0) pa, COALESCE(SUM(combo),0) combo
     FROM sales
     WHERE store_id = $1
       AND sale_date >= ($2::date - interval '120 days')
       AND sale_date < $2::date
     GROUP BY sale_date
     ORDER BY sale_date`,
    [storeId, fromDate]
  );
  const byDate = new Map<string, any>();
  for (const r of hist.rows) byDate.set(String(r.d).slice(0, 10), r);

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
    for (const m of METRICS) {
      predicted[m] = Math.round(projectDay(model[m], dow));
    }
    out.push({ date: iso, dow, predicted, model: 'ses_dow_seasonal' });
  }
  // history_days — сколько дней окна реально содержали хотя бы одну
  // продажу (не длина заполненного нулями массива для модели) — тем же
  // смыслом, что раньше, страница «Прогноз» предупреждает при < 14.
  return { items: out, history_days: hist.rows.length };
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
  const storesRes = await query(
    `SELECT id, COALESCE(display_name, name) as name FROM stores WHERE COALESCE(is_active,true)=true AND COALESCE(org_id,'default') = $1`,
    [orgId]
  );
  const stores = storesRes.rows as { id: string; name: string }[];
  if (!stores.length) return [];

  const start = todayMoscow();
  const forecasts: Record<string, Awaited<ReturnType<typeof forecastStore>>> = {};
  for (const s of stores) {
    forecasts[s.id] = await forecastStore(s.id, start, days);
  }

  const schedRes = await query(
    `SELECT store_id, work_date::text as d, COUNT(DISTINCT employee_id)::int as headcount
     FROM schedules
     WHERE work_date >= $1::date AND work_date < ($1::date + ($2 || ' days')::interval)
       AND COALESCE(hours, 0) > 0
     GROUP BY store_id, work_date`,
    [start, days]
  );
  const headcountMap: Record<string, Record<string, number>> = {};
  for (const r of schedRes.rows) {
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

/** Heatmap: агрегация продаж по часу — proxy без timestamp = по сменам равномерно */
export async function salesHeatmap(storeId: string, weeks = 4) {
  // Реальный heatmap нужен sale_hour; пока отдаём профиль store_hour_profile + факт по дням недели
  const profile = await query(
    `SELECT dow, hour, weight FROM store_hour_profile
     WHERE store_id = $1 ORDER BY dow, hour`,
    [storeId]
  );

  const byDow = await query(
    `SELECT EXTRACT(DOW FROM sale_date)::int as dow,
            COALESCE(SUM(sim),0) sim, COALESCE(SUM(mnp),0) mnp
     FROM sales
     WHERE store_id = $1
       AND sale_date >= CURRENT_DATE - ($2 * 7)
     GROUP BY 1`,
    [storeId, weeks]
  );

  return {
    store_id: storeId,
    hour_weights: profile.rows,
    dow_totals: byDow.rows,
    note: 'Для точного heatmap добавьте sale_hour в sales при внесении'
  };
}

/** Когорты новичков: выход на план за 2/4/8 недель */
export async function newbieCohorts(orgId = 'default') {
  // orgId был в сигнатуре и раньше, но нигде не читался в самом запросе —
  // функция всегда возвращала новичков всей БД, а не только своей сети.
  const emps = await query(
    `SELECT id, full_name, hire_date, created_at
     FROM employees
     WHERE COALESCE(is_active,true)=true
       AND COALESCE(org_id,'default') = $1
       AND (hire_date IS NOT NULL OR created_at IS NOT NULL)
     ORDER BY COALESCE(hire_date, created_at::date)`,
    [orgId]
  );

  const rows = [];
  for (const e of emps.rows) {
    // created_at приходит как JS Date (timestamptz), а не строка — String(Date)
    // даёт "Tue Jul 28 2026 ..." вместо ISO, и .slice(0,10) резало "Tue Jul 28",
    // что дальше падало на invalid input syntax for type date в SQL ниже.
    const startRaw = e.hire_date || e.created_at;
    const start = startRaw instanceof Date ? startRaw.toISOString().slice(0, 10) : String(startRaw).slice(0, 10);
    const weeks = [2, 4, 8];
    const points: any = {};
    for (const w of weeks) {
      const res = await query(
        `SELECT COALESCE(SUM(s.sim),0) sim, COALESCE(SUM(s.mnp),0) mnp
         FROM sales s
         WHERE s.employee_id = $1
           AND s.sale_date >= $2::date
           AND s.sale_date < ($2::date + ($3 || ' weeks')::interval)`,
        [e.id, start, w]
      );
      points[`w${w}`] = {
        sim: num(res.rows[0]?.sim),
        mnp: num(res.rows[0]?.mnp)
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
