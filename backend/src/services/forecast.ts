import { query } from '../db/index.js';

function num(v: any) {
  return Number(v) || 0;
}

/** Простой прогноз: среднее за тот же день недели за последние 8 недель */
export async function forecastStore(storeId: string, fromDate: string, days = 7) {
  const out = [];
  const start = new Date(fromDate + 'T12:00:00');

  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getDay();

    const hist = await query(
      `SELECT COALESCE(AVG(sim),0) sim, COALESCE(AVG(mnp),0) mnp,
              COALESCE(AVG(pa),0) pa, COALESCE(AVG(combo),0) combo
       FROM (
         SELECT sale_date,
                SUM(sim) sim, SUM(mnp) mnp, SUM(pa) pa, SUM(combo) combo
         FROM sales
         WHERE store_id = $1
           AND sale_date >= ($2::date - interval '56 days')
           AND sale_date < $2::date
           AND EXTRACT(DOW FROM sale_date) = $3
         GROUP BY sale_date
       ) t`,
      [storeId, iso, dow]
    );
    const h = hist.rows[0] || {};
    out.push({
      date: iso,
      dow,
      predicted: {
        sim: Math.round(num(h.sim)),
        mnp: Math.round(num(h.mnp) * 10) / 10,
        pa: Math.round(num(h.pa) * 10) / 10,
        combo: Math.round(num(h.combo) * 10) / 10
      },
      model: 'dow_avg_8w'
    });
  }
  return out;
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
export async function newbieCohorts(orgId?: string) {
  const emps = await query(
    `SELECT id, full_name, hire_date, created_at
     FROM employees
     WHERE COALESCE(is_active,true)=true
       AND (hire_date IS NOT NULL OR created_at IS NOT NULL)
     ORDER BY COALESCE(hire_date, created_at::date)`
  );

  const rows = [];
  for (const e of emps.rows) {
    const start = String(e.hire_date || e.created_at).slice(0, 10);
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
