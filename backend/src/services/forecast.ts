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
  const rows = hist.rows.map((r: any) => ({
    date: String(r.d).slice(0, 10),
    dow: new Date(String(r.d).slice(0, 10) + 'T12:00:00').getDay(),
    sim: num(r.sim), mnp: num(r.mnp), pa: num(r.pa), combo: num(r.combo)
  }));

  const model: Record<Metric, { level: number; seasonal: Record<number, number> }> = {} as any;

  for (const m of METRICS) {
    if (!rows.length) {
      model[m] = { level: 0, seasonal: {} };
      continue;
    }
    let level = rows[0][m];
    const ratioSum: Record<number, number> = {};
    const ratioCount: Record<number, number> = {};
    for (const r of rows) {
      const baseline = level > 0.01 ? level : 1; // избегаем деления на ~0 на холодном старте
      const ratio = r[m] / baseline;
      ratioSum[r.dow] = (ratioSum[r.dow] || 0) + ratio;
      ratioCount[r.dow] = (ratioCount[r.dow] || 0) + 1;
      level = ALPHA * r[m] + (1 - ALPHA) * level;
    }
    const seasonal: Record<number, number> = {};
    for (let dow = 0; dow <= 6; dow++) {
      const n = ratioCount[dow] || 0;
      const raw = n ? ratioSum[dow] / n : 1;
      seasonal[dow] = (n * raw + SHRINK_K * 1) / (n + SHRINK_K);
    }
    model[m] = { level, seasonal };
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
      const { level, seasonal } = model[m];
      predicted[m] = Math.max(0, Math.round(level * (seasonal[dow] ?? 1)));
    }
    out.push({ date: iso, dow, predicted, model: 'ses_dow_seasonal' });
  }
  return { items: out, history_days: rows.length };
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
    `SELECT id, name FROM stores WHERE COALESCE(is_active,true)=true AND COALESCE(org_id,'default') = $1`,
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
