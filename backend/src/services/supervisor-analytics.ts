/**
 * Аналитика кабинета супервайзера.
 * Health score, темп дня vs план, просадки по точкам, тренд 14д, топ продавцов.
 * scope — всегда конкретный список store_id (своя сеть по умолчанию для
 * manager/admin; весь сектор — для supervisor). Раньше manager/admin получали
 * scope=null («вся БД без фильтра») — так Command Center и кабинет
 * супервайзера показывали вообще все сети сразу.
 */
import { query } from '../db/index.js';
import { todayMoscow, currentMonthMoscow } from '../utils/date.js';
import { buildSesModel, projectDay } from './forecast.js';

// Тот же полный список, что METRICS в services/plans.ts — держим локальную
// копию (не импортируем, чтобы не тянуть весь plans.ts) для дневных и
// месячных срезов по каждому показателю, не только SIM/MNP/ПА.
const METRICS = [
  'sim', 'mnp', 'pa', 'combo', 'phones', 'accessories', 'settings',
  'insurance', 'wink', 'shpd', 'focus', 'credit_request', 'credit_issued',
  'plotter', 'hb'
] as const;

function n(v: any) {
  return Number(v) || 0;
}
function pct(fact: number, plan: number) {
  if (plan <= 0) return fact > 0 ? 100 : 0;
  return Math.round((fact / plan) * 100);
}

/** {sim:{fact,plan,pct}, mnp:{...}, ...} по всем METRICS сразу — общий
 * помощник для дневного и месячного среза (и по точке, и по сектору). */
function metricsBreakdown(factRow: any, planRow: any) {
  const out: Record<string, { fact: number; plan: number; pct: number }> = {};
  for (const m of METRICS) {
    const f = n(factRow?.[m]);
    const p = n(planRow?.[m]);
    out[m] = { fact: f, plan: p, pct: pct(f, p) };
  }
  return out;
}

// ===== Прогноз до конца месяца =====
// Числовая модель (SES + сезонность дня недели) вынесена в
// services/forecast.ts::buildSesModel/projectDay — раньше здесь была
// задублированная копия того же алгоритма. Здесь только батчинг ОДНИМ
// запросом на весь список точек сразу (там это один store_id за раз,
// приемлемо для одной точки, не для сектора из 10-50 точек × 15 метрик).

/** store_id -> {metric: прогноз суммы по ОСТАВШИМСЯ дням месяца (не считая date)} */
async function forecastRemainingOfMonth(
  storeIds: string[],
  date: string,
  month: string
): Promise<Map<string, Record<string, number>>> {
  const result = new Map<string, Record<string, number>>();
  if (!storeIds.length) return result;

  const lastDayDate = new Date(month + '-01T12:00:00');
  lastDayDate.setMonth(lastDayDate.getMonth() + 1);
  lastDayDate.setDate(0);
  const lastDay = lastDayDate.toISOString().slice(0, 10);

  const remainingDates: { dow: number }[] = [];
  const cursor = new Date(date + 'T12:00:00');
  cursor.setDate(cursor.getDate() + 1);
  const end = new Date(lastDay + 'T12:00:00');
  while (cursor <= end) {
    remainingDates.push({ dow: cursor.getDay() });
    cursor.setDate(cursor.getDate() + 1);
  }
  if (!remainingDates.length) {
    for (const id of storeIds) {
      const zero: Record<string, number> = {};
      for (const m of METRICS) zero[m] = 0;
      result.set(id, zero);
    }
    return result;
  }

  const histCols = METRICS.map((m) => `COALESCE(SUM(${m}),0) as ${m}`).join(', ');
  const hist = await query(
    `SELECT store_id, sale_date::text as d, ${histCols}
     FROM sales
     WHERE store_id = ANY($1) AND sale_date >= ($2::date - interval '120 days') AND sale_date < $2::date
     GROUP BY store_id, sale_date
     ORDER BY store_id, sale_date`,
    [storeIds, date]
  ).catch(() => ({ rows: [] as any[] }));

  // GROUP BY sale_date пропускает дни без продаж вообще — если их молча
  // выкинуть, сглаженный уровень никогда не увидит настоящий "0" и не
  // спустится вниз, застревая на случайном высоком дне (особенно заметно
  // на денежных метриках вроде "Телефоны": один крупный чек и дальше тишина
  // без учёта нулей давал прогноз в 1700%+ плана — реальный баг, найден
  // визуальной проверкой перед деплоем). Досыпаем явные нули на пропущенные
  // дни — тот же приём, что уже используется для `trend` чуть ниже.
  const histByDateByStore = new Map<string, Map<string, any>>();
  for (const r of hist.rows) {
    const d = String(r.d).slice(0, 10);
    if (!histByDateByStore.has(r.store_id)) histByDateByStore.set(r.store_id, new Map());
    histByDateByStore.get(r.store_id)!.set(d, r);
  }
  const byStore = new Map<string, { dow: number; [k: string]: number }[]>();
  for (const storeId of storeIds) {
    const byDate = histByDateByStore.get(storeId);
    const list: { dow: number; [k: string]: number }[] = [];
    const dCursor = new Date(date + 'T12:00:00');
    dCursor.setDate(dCursor.getDate() - 120);
    const dEnd = new Date(date + 'T12:00:00');
    while (dCursor < dEnd) {
      const key = dCursor.toISOString().slice(0, 10);
      const r = byDate?.get(key);
      const row: { dow: number; [k: string]: number } = { dow: dCursor.getDay() };
      for (const m of METRICS) row[m] = r ? n(r[m]) : 0;
      list.push(row);
      dCursor.setDate(dCursor.getDate() + 1);
    }
    byStore.set(storeId, list);
  }

  for (const storeId of storeIds) {
    const rows = byStore.get(storeId) || [];
    const projected: Record<string, number> = {};
    for (const m of METRICS) {
      if (!rows.length) { projected[m] = 0; continue; }
      const model = buildSesModel(rows.map((r) => ({ dow: r.dow, value: r[m] })));
      let sum = 0;
      for (const rd of remainingDates) sum += projectDay(model, rd.dow);
      projected[m] = Math.round(sum);
    }
    result.set(storeId, projected);
  }
  return result;
}

export type StoreScope = string[] | null; // null = все точки (сейчас нигде не возвращается)

export async function resolveSupervisorStores(
  employeeId: number,
  role: string,
  orgId?: string
): Promise<StoreScope> {
  if (role === 'admin' || role === 'manager') {
    try {
      const res = await query(`SELECT id FROM stores WHERE COALESCE(org_id, 'default') = $1`, [orgId || 'default']);
      return res.rows.map((r: any) => String(r.id));
    } catch {
      return [];
    }
  }
  // supervisor = руководитель сектора: видит все точки всех сетей своего
  // сектора (назначение — на сектор целиком, не по отдельным точкам).
  try {
    const res = await query(
      `SELECT s.id as store_id
       FROM supervisor_sectors ss
       JOIN organizations o ON o.sector_id = ss.sector_id
       JOIN stores s ON COALESCE(s.org_id, 'default') = o.id
       WHERE ss.supervisor_id = $1`,
      [employeeId]
    );
    return res.rows.map((r: any) => String(r.store_id));
  } catch {
    return [];
  }
}

function storeFilterSql(scope: StoreScope, alias = 'st', paramIdx = 1) {
  if (scope === null) return { sql: '', params: [] as any[] };
  if (!scope.length) return { sql: ' AND false ', params: [] as any[] };
  return {
    sql: ` AND ${alias}.id = ANY($${paramIdx}) `,
    params: [scope]
  };
}

/** Главный дашборд супервайзера */
export async function buildSupervisorDashboard(opts: {
  scope: StoreScope;
  date?: string;
  days?: number;
}) {
  const date = opts.date || todayMoscow();
  const days = Math.min(Math.max(opts.days || 14, 7), 60);
  const month = date.slice(0, 7);
  const monthStart = `${month}-01`;

  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() - (days - 1));
  const from = d.toISOString().slice(0, 10);

  // Список точек + название сети (o.name) — кабинет супервайзера кросс-сетевой
  // по своей сути (сектор = несколько сетей), без названия сети непонятно,
  // какая точка из какой сети в общем списке.
  let storesRes;
  if (opts.scope === null) {
    storesRes = await query(
      `SELECT s.id, COALESCE(s.display_name, s.name) as name, s.display_name, s.code, COALESCE(s.color, '#2AABEE') as color,
              COALESCE(s.org_id, 'default') as org_id, COALESCE(o.name, 'default') as org_name
       FROM stores s LEFT JOIN organizations o ON o.id = COALESCE(s.org_id, 'default')
       WHERE COALESCE(s.is_active, true) = true ORDER BY s.name`
    );
  } else if (!opts.scope.length) {
    return emptyDash(from, date, month);
  } else {
    storesRes = await query(
      `SELECT s.id, COALESCE(s.display_name, s.name) as name, s.display_name, s.code, COALESCE(s.color, '#2AABEE') as color,
              COALESCE(s.org_id, 'default') as org_id, COALESCE(o.name, 'default') as org_name
       FROM stores s LEFT JOIN organizations o ON o.id = COALESCE(s.org_id, 'default')
       WHERE s.id = ANY($1) AND COALESCE(s.is_active, true) = true ORDER BY s.name`,
      [opts.scope]
    );
  }
  const stores = storesRes.rows || [];
  const storeIds = stores.map((s: any) => String(s.id));

  // Пустой список точек — не дергаем SQL с ANY([])
  if (!storeIds.length) {
    return emptyDash(from, date, month);
  }

  // факт сегодня по точкам — все METRICS, не только SIM/MNP/ПА (нужно для
  // разворачиваемого списка «Ещё метрики» на вкладке «Точки»)
  const todaySumCols = METRICS.map((m) => `COALESCE(SUM(${m}),0) as ${m}`).join(', ');
  const todayFact = await query(
    `SELECT store_id, ${todaySumCols}
     FROM sales WHERE sale_date::date = $1::date AND store_id = ANY($2)
     GROUP BY store_id`,
    [date, storeIds]
  ).catch(() => ({ rows: [] as any[] }));

  const factMap = new Map(todayFact.rows.map((r: any) => [r.store_id, r]));

  // планы на дату
  const plans = await query(
    `SELECT * FROM store_plans WHERE plan_date::date = $1::date AND store_id = ANY($2)`,
    [date, storeIds]
  ).catch(() => ({ rows: [] as any[] }));
  let planMap = new Map(plans.rows.map((r: any) => [r.store_id, r]));
  if (!planMap.size) {
    const tpl = await query(
      `SELECT * FROM store_plans WHERE plan_date IS NULL AND store_id = ANY($1)`,
      [storeIds]
    ).catch(() => ({ rows: [] as any[] }));
    planMap = new Map(tpl.rows.map((r: any) => [r.store_id, r]));
  }

  // смены сегодня
  const shifts = await query(
    `SELECT sch.store_id, e.id as employee_id, e.full_name, sch.shift_text, sch.hours
     FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     WHERE sch.work_date::date = $1::date AND COALESCE(sch.hours,0) > 0
       AND sch.store_id = ANY($2)
     ORDER BY sch.store_id, e.full_name`,
    [date, storeIds]
  ).catch(() => ({ rows: [] as any[] }));

  const shiftByStore = new Map<string, any[]>();
  for (const r of shifts.rows) {
    if (!shiftByStore.has(r.store_id)) shiftByStore.set(r.store_id, []);
    shiftByStore.get(r.store_id)!.push(r);
  }

  // series 14 days for charts
  const series = await query(
    // sale_date::text (не ::date) — раньше `d` возвращался JS Date-объектом
    // (node-postgres парсит date-колонку в полночь ПО ЛОКАЛЬНОМУ времени
    // процесса), а String(dateObj) даёт "Tue Aug 11", не "2026-08-11" —
    // seriesMap ключился нечитаемой строкой, которая никогда не совпадала
    // с ключом ниже (cursor.toISOString()), и trend был ВСЕГДА пустым
    // (тот же класс бага, что чинили в toDateISO() 17.10.0 — там, где
    // рядом forecastRemainingOfMonth уже кастует в ::text, бага нет).
    `SELECT sale_date::text as d,
       COALESCE(SUM(sim),0) sim, COALESCE(SUM(mnp),0) mnp, COALESCE(SUM(pa),0) pa,
       COALESCE(SUM(combo),0) combo
     FROM sales
     WHERE sale_date >= $1::date AND sale_date <= $2::date AND store_id = ANY($3)
     GROUP BY sale_date::date
     ORDER BY d`,
    [from, date, storeIds]
  ).catch(() => ({ rows: [] as any[] }));

  // fill missing days
  const seriesMap = new Map(series.rows.map((r: any) => [String(r.d).slice(0, 10), r]));
  const trend: { date: string; sim: number; mnp: number; pa: number; combo: number; units: number }[] = [];
  const cursor = new Date(from + 'T12:00:00');
  const end = new Date(date + 'T12:00:00');
  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    const r = seriesMap.get(key) || {};
    const sim = n(r.sim), mnp = n(r.mnp), pa = n(r.pa), combo = n(r.combo);
    trend.push({ date: key, sim, mnp, pa, combo, units: sim + mnp + pa + combo });
    cursor.setDate(cursor.getDate() + 1);
  }

  // факт с начала месяца по точкам — все METRICS (нужно для «Выполнение
  // месячного плана» и как база для прогноза до конца месяца)
  const monthSumCols = METRICS.map((m) => `COALESCE(SUM(${m}),0) as ${m}`).join(', ');
  const monthFact = await query(
    `SELECT store_id, ${monthSumCols}
     FROM sales
     WHERE sale_date >= $1::date AND sale_date <= $2::date AND store_id = ANY($3)
     GROUP BY store_id`,
    [monthStart, date, storeIds]
  ).catch(() => ({ rows: [] as any[] }));
  const monthMap = new Map(monthFact.rows.map((r: any) => [r.store_id, r]));

  // месячные планы точек (store_month_plans) — бывший single-store хелпер
  // getStoreMonthPlan() тут не переиспользуем, батчим одним запросом на
  // весь сектор, а не по точке за раз
  const monthPlansRes = await query(
    `SELECT * FROM store_month_plans WHERE store_id = ANY($1) AND month = $2::date`,
    [storeIds, monthStart]
  ).catch(() => ({ rows: [] as any[] }));
  const monthPlanMap = new Map(monthPlansRes.rows.map((r: any) => [r.store_id, r]));

  // Прогноз до конца месяца — SES + сезонность на день недели (см.
  // forecastRemainingOfMonth выше), один батч-запрос на весь сектор.
  const forecastMap = await forecastRemainingOfMonth(storeIds, date, month);

  // assemble store cards
  const storeCards = [];
  const drops: any[] = [];
  let netSim = 0, netMnp = 0, netPa = 0, netPlanSim = 0, netPlanMnp = 0, netPlanPa = 0;
  // сектор-wide суммы за месяц (факт/план/прогноз) по каждой метрике
  const netMonthFact: Record<string, number> = {};
  const netMonthPlan: Record<string, number> = {};
  const netMonthForecast: Record<string, number> = {};
  for (const m of METRICS) { netMonthFact[m] = 0; netMonthPlan[m] = 0; netMonthForecast[m] = 0; }

  for (const st of stores) {
    const f = factMap.get(st.id) || {};
    const p = planMap.get(st.id) || {};
    const mf = monthMap.get(st.id) || {};
    const mp = monthPlanMap.get(st.id) || {};
    const remaining = forecastMap.get(st.id) || {};
    const staff = shiftByStore.get(st.id) || [];

    const sim = n(f.sim), mnp = n(f.mnp), pa = n(f.pa);
    const pSim = n(p.sim), pMnp = n(p.mnp), pPa = n(p.pa);
    const simPct = pct(sim, pSim);
    const mnpPct = pct(mnp, pMnp);
    const paPct = pct(pa, pPa);
    const overall = Math.round((simPct + mnpPct + paPct) / 3);

    netSim += sim; netMnp += mnp; netPa += pa;
    netPlanSim += pSim; netPlanMnp += pMnp; netPlanPa += pPa;

    // Разворачиваемый список «Ещё метрики» — сегодня и месяц (факт/план/%),
    // плюс прогноз на конец месяца (факт с начала месяца + прогноз остатка).
    const todayMetrics = metricsBreakdown(f, p);
    const monthMetrics = metricsBreakdown(mf, mp);
    const monthForecastMetrics: Record<string, { total: number; plan: number; pct: number }> = {};
    for (const m of METRICS) {
      const factVal = n(mf[m]);
      const planVal = n(mp[m]);
      const total = factVal + n(remaining[m]);
      monthForecastMetrics[m] = { total, plan: planVal, pct: pct(total, planVal) };
      netMonthFact[m] += factVal;
      netMonthPlan[m] += planVal;
      netMonthForecast[m] += total;
    }

    const alerts: string[] = [];
    if (staff.length && overall < 40 && (pSim + pMnp + pPa) > 0) {
      alerts.push(`План дня ~${overall}% — просадка`);
    }
    if (sim >= 3 && mnp === 0 && pMnp > 0) {
      alerts.push('Есть SIM, но 0 MNP — нетипично');
    }
    if (!staff.length) {
      alerts.push('Никого на смене');
    }
    if (staff.length && sim + mnp + pa === 0 && (pSim + pMnp) > 0) {
      alerts.push('0 продаж при плане и смене');
    }

    for (const a of alerts) {
      drops.push({
        store_id: st.id,
        store_name: st.name,
        severity: a.includes('0 продаж') || overall < 30 ? 'critical' : 'warn',
        message: a,
        overall
      });
    }

    storeCards.push({
      store_id: st.id,
      name: st.name,
      display_name: st.display_name,
      code: st.code,
      color: st.color || '#2AABEE',
      org_id: st.org_id,
      org_name: st.org_name,
      staff_count: staff.length,
      staff: staff.map((x: any) => ({
        id: x.employee_id,
        name: x.full_name,
        shift: x.shift_text,
        hours: x.hours
      })),
      today: {
        sim, mnp, pa,
        combo: n(f.combo),
        phones: n(f.phones),
        accessories: n(f.accessories),
        plan_sim: pSim,
        plan_mnp: pMnp,
        plan_pa: pPa,
        pct_sim: simPct,
        pct_mnp: mnpPct,
        pct_pa: paPct,
        overall,
        metrics: todayMetrics
      },
      month: {
        sim: n(mf.sim),
        mnp: n(mf.mnp),
        pa: n(mf.pa),
        combo: n(mf.combo),
        phones: n(mf.phones),
        metrics: monthMetrics,
        forecast: monthForecastMetrics
      },
      alerts
    });
  }

  storeCards.sort((a, b) => a.today.overall - b.today.overall);

  // top employees period (+ их сеть — кросс-сетевой топ иначе не показывает,
  // кто откуда, что важно для сектора из нескольких сетей)
  const topEmp = await query(
    `SELECT e.id, e.full_name, COALESCE(e.org_id,'default') as org_id, COALESCE(o.name,'default') as org_name,
       COALESCE(SUM(s.sim),0) sim, COALESCE(SUM(s.mnp),0) mnp,
       COALESCE(SUM(s.pa),0) pa, COALESCE(SUM(s.combo),0) combo,
       COALESCE(SUM(s.phones),0) phones
     FROM sales s
     JOIN employees e ON e.id = s.employee_id
     LEFT JOIN organizations o ON o.id = COALESCE(e.org_id, 'default')
     WHERE s.sale_date >= $1::date AND s.sale_date <= $2::date
       AND s.store_id = ANY($3)
     GROUP BY e.id, e.full_name, e.org_id, o.name
     ORDER BY (COALESCE(SUM(s.sim),0)*2 + COALESCE(SUM(s.mnp),0)*3 + COALESCE(SUM(s.pa),0)*2) DESC
     LIMIT 15`,
    [from, date, storeIds]
  ).catch(() => ({ rows: [] as any[] }));

  // pace: expected % of day by hour (simple linear 10-21)
  const nowMsk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
  const hour = nowMsk.getHours() + nowMsk.getMinutes() / 60;
  const open = 10, close = 21;
  const dayProgress =
    hour <= open ? 0 : hour >= close ? 100 : Math.round(((hour - open) / (close - open)) * 100);

  const networkOverall = pct(
    netSim + netMnp + netPa,
    netPlanSim + netPlanMnp + netPlanPa
  );
  const paceDelta = networkOverall - dayProgress; // >0 ahead, <0 behind

  // health score 0-100
  const dropPenalty = Math.min(40, drops.filter((d) => d.severity === 'critical').length * 12 + drops.length * 4);
  const health = Math.max(0, Math.min(100, Math.round(networkOverall * 0.7 + (100 - dropPenalty) * 0.3)));

  // AI-комментарий к просадке — генерируется раз в день в cron/reports.ts
  // при отправке итогового отчёта; здесь только подтягиваем готовый текст.
  if (drops.length) {
    const dropStoreIds = [...new Set(drops.map((d) => d.store_id))];
    const aiRes = await query(
      `SELECT DISTINCT ON (store_id) store_id, response
       FROM ai_audit
       WHERE kind = 'dip_comment' AND ref_date = $1::date AND store_id = ANY($2)
       ORDER BY store_id, created_at DESC`,
      [date, dropStoreIds]
    ).catch(() => ({ rows: [] as any[] }));
    const aiByStore = new Map(aiRes.rows.map((r: any) => [r.store_id, r.response]));
    for (const d of drops) {
      const c = aiByStore.get(d.store_id);
      if (c) d.ai_comment = c;
    }
  }

  // Сектор-wide выполнение месячного плана — сумма планов ВСЕХ точек сектора
  // по каждой метрике против суммы факта, плюс сумма прогнозов каждой точки
  // до конца месяца (не пересчитано заново на объединённой истории — сумма
  // отдельных прогнозов точнее, у разных точек разные дни-недели-паттерны).
  const monthMetricsNet: Record<string, { fact: number; plan: number; pct: number }> = {};
  const monthForecastNet: Record<string, { total: number; plan: number; pct: number }> = {};
  for (const m of METRICS) {
    monthMetricsNet[m] = { fact: netMonthFact[m], plan: netMonthPlan[m], pct: pct(netMonthFact[m], netMonthPlan[m]) };
    monthForecastNet[m] = { total: netMonthForecast[m], plan: netMonthPlan[m], pct: pct(netMonthForecast[m], netMonthPlan[m]) };
  }

  return {
    date,
    from,
    month,
    scope: opts.scope === null ? 'all' : 'limited',
    network: {
      health,
      overall_pct: networkOverall,
      day_progress_pct: dayProgress,
      pace_delta: paceDelta,
      sim: netSim,
      mnp: netMnp,
      pa: netPa,
      plan_sim: netPlanSim,
      plan_mnp: netPlanMnp,
      plan_pa: netPlanPa,
      stores_count: stores.length,
      staff_on_shift: shifts.rows.length,
      drops_count: drops.length,
      month: { metrics: monthMetricsNet, forecast: monthForecastNet }
    },
    stores: storeCards,
    drops: drops.sort((a, b) => (a.severity === 'critical' ? -1 : 1)),
    trend,
    top_employees: topEmp.rows.map((e: any, i: number) => ({
      rank: i + 1,
      id: e.id,
      full_name: e.full_name,
      org_id: e.org_id,
      org_name: e.org_name,
      sim: n(e.sim),
      mnp: n(e.mnp),
      pa: n(e.pa),
      combo: n(e.combo),
      phones: n(e.phones),
      score: n(e.sim) * 2 + n(e.mnp) * 3 + n(e.pa) * 2
    })),
    generated_at: new Date().toISOString()
  };
}

/**
 * Сотрудники, просевшие СЕГОДНЯ относительно своей же смены — не топ (уже
 * есть top_employees), а обратное. Простая, объяснимая эвристика, не ML:
 * сотрудник на смене сегодня, у него 0 продаж, но на ТОЙ ЖЕ точке в ТОТ ЖЕ
 * день есть хотя бы один коллега с ненулевыми продажами (иначе это уже
 * store-level drop "0 продаж при плане и смене" из buildSupervisorDashboard,
 * не персональная просадка) — и уже вторая половина дня (после 14:00 МСК),
 * чтобы не ловить того, кто просто час назад открыл смену.
 */
export async function findUnderperformingEmployees(scope: StoreScope, date: string) {
  const nowMsk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
  if (date === todayMoscow() && nowMsk.getHours() < 14) return [];

  const filter = storeFilterSql(scope, 'st', 1);
  if (scope !== null && !scope.length) return [];

  const res = await query(
    `SELECT sch.employee_id, e.full_name, sch.store_id, COALESCE(st.display_name, st.name) as store_name,
       COALESCE(SUM(s.sim + s.mnp + s.pa + s.combo), 0) as units
     FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     JOIN stores st ON st.id = sch.store_id
     LEFT JOIN sales s ON s.employee_id = sch.employee_id AND s.store_id = sch.store_id
       AND s.sale_date::date = sch.work_date::date
     WHERE sch.work_date::date = $${scope !== null ? 2 : 1}::date
       AND COALESCE(sch.hours, 0) > 0
       ${filter.sql}
     GROUP BY sch.employee_id, e.full_name, sch.store_id, st.name, st.display_name`,
    scope !== null ? [...filter.params, date] : [date]
  ).catch(() => ({ rows: [] as any[] }));

  const byStore = new Map<string, { employee_id: number; full_name: string; units: number }[]>();
  for (const r of res.rows) {
    if (!byStore.has(r.store_id)) byStore.set(r.store_id, []);
    byStore.get(r.store_id)!.push({ employee_id: Number(r.employee_id), full_name: r.full_name, units: n(r.units) });
  }

  const out: { employee_id: number; full_name: string; store_id: string; store_name: string }[] = [];
  const storeNames = new Map(res.rows.map((r: any) => [r.store_id, r.store_name]));
  for (const [storeId, staff] of byStore) {
    const hasAnySales = staff.some((s) => s.units > 0);
    if (!hasAnySales) continue; // уже store-level drop, не дублируем
    for (const s of staff) {
      if (s.units === 0) {
        out.push({ employee_id: s.employee_id, full_name: s.full_name, store_id: storeId, store_name: storeNames.get(storeId) });
      }
    }
  }
  return out;
}

function emptyDash(from: string, date: string, month: string) {
  const emptyMetrics: Record<string, { fact: number; plan: number; pct: number }> = {};
  const emptyForecast: Record<string, { total: number; plan: number; pct: number }> = {};
  for (const m of METRICS) {
    emptyMetrics[m] = { fact: 0, plan: 0, pct: 0 };
    emptyForecast[m] = { total: 0, plan: 0, pct: 0 };
  }
  return {
    date,
    from,
    month,
    scope: 'limited',
    network: {
      health: 0,
      overall_pct: 0,
      day_progress_pct: 0,
      pace_delta: 0,
      sim: 0, mnp: 0, pa: 0,
      plan_sim: 0, plan_mnp: 0, plan_pa: 0,
      stores_count: 0,
      staff_on_shift: 0,
      drops_count: 0,
      month: { metrics: emptyMetrics, forecast: emptyForecast }
    },
    stores: [],
    drops: [{ severity: 'warn', message: 'Нет привязанного сектора. Manager: назначь сектор через PUT /supervisor/:id/sector', store_name: '—' }],
    trend: [],
    top_employees: [],
    generated_at: new Date().toISOString()
  };
}
