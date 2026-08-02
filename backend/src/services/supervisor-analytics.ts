/**
 * Аналитика для супервайзера / управляющего
 */
import { query } from '../db/index.js';
import { todayMoscow, currentMonthMoscow } from '../utils/date.js';

function n(v: any) {
  return Number(v) || 0;
}
function pct(fact: number, plan: number) {
  if (plan <= 0) return fact > 0 ? 100 : 0;
  return Math.round((fact / plan) * 100);
}

export type StoreScope = string[] | null; // null = все точки

export async function resolveSupervisorStores(
  employeeId: number,
  role: string
): Promise<StoreScope> {
  if (role === 'admin' || role === 'manager') return null;
  try {
    const res = await query(
      `SELECT store_id FROM supervisor_stores WHERE supervisor_id = $1`,
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

  // список точек
  let storesRes;
  if (opts.scope === null) {
    storesRes = await query(
      `SELECT id, name, code, COALESCE(color, '#2AABEE') as color
       FROM stores WHERE COALESCE(is_active, true) = true ORDER BY name`
    );
  } else if (!opts.scope.length) {
    return emptyDash(from, date, month);
  } else {
    storesRes = await query(
      `SELECT id, name, code, COALESCE(color, '#2AABEE') as color
       FROM stores WHERE id = ANY($1) AND COALESCE(is_active, true) = true ORDER BY name`,
      [opts.scope]
    );
  }
  const stores = storesRes.rows;
  const storeIds = stores.map((s: any) => s.id);

  // факт сегодня по точкам
  const todayFact = await query(
    `SELECT store_id,
       COALESCE(SUM(sim),0) sim, COALESCE(SUM(mnp),0) mnp, COALESCE(SUM(pa),0) pa,
       COALESCE(SUM(combo),0) combo, COALESCE(SUM(phones),0) phones,
       COALESCE(SUM(accessories),0) accessories, COALESCE(SUM(hb),0) hb
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
    `SELECT sale_date::date as d,
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

  // month fact per store
  const monthFact = await query(
    `SELECT store_id,
       COALESCE(SUM(sim),0) sim, COALESCE(SUM(mnp),0) mnp, COALESCE(SUM(pa),0) pa,
       COALESCE(SUM(combo),0) combo, COALESCE(SUM(phones),0) phones
     FROM sales
     WHERE sale_date >= $1::date AND sale_date <= $2::date AND store_id = ANY($3)
     GROUP BY store_id`,
    [monthStart, date, storeIds]
  ).catch(() => ({ rows: [] as any[] }));
  const monthMap = new Map(monthFact.rows.map((r: any) => [r.store_id, r]));

  // assemble store cards
  const storeCards = [];
  const drops: any[] = [];
  let netSim = 0, netMnp = 0, netPa = 0, netPlanSim = 0, netPlanMnp = 0, netPlanPa = 0;

  for (const st of stores) {
    const f = factMap.get(st.id) || {};
    const p = planMap.get(st.id) || {};
    const mf = monthMap.get(st.id) || {};
    const staff = shiftByStore.get(st.id) || [];

    const sim = n(f.sim), mnp = n(f.mnp), pa = n(f.pa);
    const pSim = n(p.sim), pMnp = n(p.mnp), pPa = n(p.pa);
    const simPct = pct(sim, pSim);
    const mnpPct = pct(mnp, pMnp);
    const paPct = pct(pa, pPa);
    const overall = Math.round((simPct + mnpPct + paPct) / 3);

    netSim += sim; netMnp += mnp; netPa += pa;
    netPlanSim += pSim; netPlanMnp += pMnp; netPlanPa += pPa;

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
      code: st.code,
      color: st.color || '#2AABEE',
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
        overall
      },
      month: {
        sim: n(mf.sim),
        mnp: n(mf.mnp),
        pa: n(mf.pa),
        combo: n(mf.combo),
        phones: n(mf.phones)
      },
      alerts
    });
  }

  storeCards.sort((a, b) => a.today.overall - b.today.overall);

  // top employees period
  const topEmp = await query(
    `SELECT e.id, e.full_name,
       COALESCE(SUM(s.sim),0) sim, COALESCE(SUM(s.mnp),0) mnp,
       COALESCE(SUM(s.pa),0) pa, COALESCE(SUM(s.combo),0) combo,
       COALESCE(SUM(s.phones),0) phones
     FROM sales s
     JOIN employees e ON e.id = s.employee_id
     WHERE s.sale_date >= $1::date AND s.sale_date <= $2::date
       AND s.store_id = ANY($3)
     GROUP BY e.id, e.full_name
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
      drops_count: drops.length
    },
    stores: storeCards,
    drops: drops.sort((a, b) => (a.severity === 'critical' ? -1 : 1)),
    trend,
    top_employees: topEmp.rows.map((e: any, i: number) => ({
      rank: i + 1,
      id: e.id,
      full_name: e.full_name,
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

function emptyDash(from: string, date: string, month: string) {
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
      drops_count: 0
    },
    stores: [],
    drops: [{ severity: 'warn', message: 'Нет привязанных точек. Admin: назначь supervisor_stores', store_name: '—' }],
    trend: [],
    top_employees: [],
    generated_at: new Date().toISOString()
  };
}
