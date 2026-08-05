/**
 * Месячные планы → дневные → планы точек
 * Единый список метрик (как в sales / frontend)
 */
import { query } from '../db/index.js';
import { getMetricIds, getMetricDefs } from './metrics-catalog.js';

/** Все метрики плана/факта — везде одинаково */
export const METRICS = [
  'sim',
  'mnp',
  'pa',
  'combo',
  'phones',
  'accessories',
  'focus',
  'settings',
  'wink',
  'shpd',
  'insurance',
  'credit_request',
  'credit_issued',
  'plotter',
  'hb'
] as const;

export type Metric = (typeof METRICS)[number];

/** Алиасы со старых имён (frontend/legacy) */
const ALIASES: Record<string, Metric> = {
  credit: 'credit_issued',
  кр: 'credit_issued',
  nv: 'hb',
  нв: 'hb'
};

function num(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function monthStart(month: string) {
  return month.length === 7 ? `${month}-01` : month.slice(0, 10);
}

function monthEndExclusive(month: string) {
  const start = monthStart(month);
  const d = new Date(start + 'T12:00:00');
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

function todayMoscow() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function daysInMonth(month: string) {
  const [y, m] = monthStart(month).split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function remainingDaysInMonth(month: string) {
  const today = todayMoscow();
  const start = monthStart(month);
  const end = monthEndExclusive(month);
  if (today < start) return daysInMonth(month);
  if (today >= end) return 0;
  const last = new Date(end + 'T12:00:00');
  last.setDate(last.getDate() - 1);
  const t = new Date(today + 'T12:00:00');
  return Math.max(0, Math.round((last.getTime() - t.getTime()) / 86400000) + 1);
}

function normalizePlanInput(data: Record<string, any>): Record<Metric, number> {
  const out = {} as Record<Metric, number>;
  for (const m of METRICS) out[m] = 0;

  for (const [k, v] of Object.entries(data || {})) {
    const key = (ALIASES[k] || k) as Metric;
    if ((METRICS as readonly string[]).includes(key)) {
      out[key] = num(v);
    }
  }
  // legacy: если пришёл только credit — в credit_issued
  if (data?.credit != null && data?.credit_issued == null) {
    out.credit_issued = num(data.credit);
  }
  return out;
}

/** Колонки sales, которые реально есть в БД (кэш) */
let salesColumnsCache: Set<string> | null = null;

async function getSalesColumns(): Promise<Set<string>> {
  if (salesColumnsCache) return salesColumnsCache;
  try {
    const res = await query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'sales'`
    );
    salesColumnsCache = new Set(res.rows.map((r: any) => String(r.column_name)));
  } catch {
    salesColumnsCache = new Set([
      ...METRICS,
      'employee_id',
      'store_id',
      'sale_date'
    ] as string[]);
  }
  return salesColumnsCache;
}

export async function getEmployeeMonthFacts(employeeId: number, month: string) {
  const start = monthStart(month);
  const end = monthEndExclusive(month);

  // 1) Базовый запрос — всегда, без «лишних» колонок
  const BASE = [
    'sim', 'mnp', 'pa', 'combo', 'phones', 'accessories',
    'focus', 'settings', 'wink', 'shpd', 'insurance',
    'credit_request', 'credit_issued', 'plotter', 'hb'
  ] as const;

  const out: Record<string, number> = {};
  for (const m of METRICS) out[m] = 0;

  try {
    const cols = await getSalesColumns();
    const sumCols = BASE.filter((c) => cols.has(c));
    if (!sumCols.length) {
      // совсем старая схема
      const res = await query(
        `SELECT
           COALESCE(SUM(sim),0) as sim, COALESCE(SUM(mnp),0) as mnp,
           COALESCE(SUM(pa),0) as pa, COALESCE(SUM(combo),0) as combo,
           COALESCE(SUM(phones),0) as phones
         FROM sales
         WHERE employee_id = $1 AND sale_date >= $2::date AND sale_date < $3::date`,
        [employeeId, start, end]
      );
      const row = res.rows[0] || {};
      for (const k of Object.keys(row)) out[k] = num(row[k]);
      return out;
    }

    const selectParts = sumCols.map((c) => `COALESCE(SUM(${c}),0) as ${c}`);
    const res = await query(
      `SELECT ${selectParts.join(', ')}
       FROM sales
       WHERE employee_id = $1
         AND sale_date >= $2::date
         AND sale_date < $3::date`,
      [employeeId, start, end]
    );
    const row = res.rows[0] || {};
    for (const c of sumCols) out[c] = num(row[c]);

    // 2) Кастомные метрики — только если колонка есть
    const catalogIds = await getMetricIds().catch(() => [] as string[]);
    const extra = catalogIds.filter(
      (id) =>
        /^[a-z][a-z0-9_]{0,29}$/.test(id) &&
        cols.has(id) &&
        !sumCols.includes(id as any)
    );
    if (extra.length) {
      const parts = extra.map((c) => `COALESCE(SUM(${c}),0) as ${c}`);
      try {
        const r2 = await query(
          `SELECT ${parts.join(', ')}
           FROM sales
           WHERE employee_id = $1
             AND sale_date >= $2::date
             AND sale_date < $3::date`,
          [employeeId, start, end]
        );
        const row2 = r2.rows[0] || {};
        for (const c of extra) out[c] = num(row2[c]);
      } catch (e) {
        console.warn('extra metric facts failed:', (e as any)?.message || e);
      }
    }

    // legacy credit
    if (out.credit_issued === 0 && (row as any).credit != null) {
      out.credit_issued = num((row as any).credit);
    }
    return out;
  } catch (e) {
    console.error('getEmployeeMonthFacts failed:', (e as any)?.message || e);
    // 3) Последний шанс — минимальный набор
    try {
      const res = await query(
        `SELECT
           COALESCE(SUM(sim),0) as sim, COALESCE(SUM(mnp),0) as mnp,
           COALESCE(SUM(pa),0) as pa, COALESCE(SUM(combo),0) as combo,
           COALESCE(SUM(phones),0) as phones,
           COALESCE(SUM(accessories),0) as accessories
         FROM sales
         WHERE employee_id = $1 AND sale_date >= $2::date AND sale_date < $3::date`,
        [employeeId, start, end]
      );
      const row = res.rows[0] || {};
      for (const k of Object.keys(row)) out[k] = num(row[k]);
    } catch (e2) {
      console.error('facts fallback failed:', (e2 as any)?.message || e2);
    }
    return out;
  }
}

export async function getEmployeeShiftCount(employeeId: number, month: string) {
  const start = monthStart(month);
  const end = monthEndExclusive(month);
  const res = await query(
    `SELECT COUNT(*)::int as cnt FROM schedules
     WHERE employee_id = $1 AND work_date >= $2 AND work_date < $3 AND hours > 0`,
    [employeeId, start, end]
  );
  return num(res.rows[0]?.cnt);
}

export async function getEmployeeRemainingShifts(employeeId: number, month: string) {
  const today = todayMoscow();
  const end = monthEndExclusive(month);
  const res = await query(
    `SELECT COUNT(*)::int as cnt FROM schedules
     WHERE employee_id = $1 AND work_date >= $2 AND work_date < $3 AND hours > 0`,
    [employeeId, today, end]
  );
  return num(res.rows[0]?.cnt);
}

export async function getEmployeeMonthPlan(employeeId: number, month: string) {
  const start = monthStart(month);
  const res = await query(
    `SELECT * FROM employee_month_plans WHERE employee_id = $1 AND month = $2::date`,
    [employeeId, start]
  ).catch(() =>
    query(
      `SELECT * FROM employee_month_plans WHERE employee_id = $1 AND month::text LIKE $2`,
      [employeeId, start.slice(0, 7) + '%']
    )
  );
  const row = res.rows[0];
  if (!row) return null;

  // нормализуем credit → credit_issued
  const plan: Record<string, any> = { ...row };
  if (plan.credit != null && plan.credit_issued == null) {
    plan.credit_issued = plan.credit;
  }
  for (const m of METRICS) {
    if (plan[m] == null) plan[m] = 0;
  }
  return plan;
}

export async function upsertEmployeeMonthPlan(
  employeeId: number,
  month: string,
  data: Record<string, number>
) {
  const start = monthStart(month);
  const norm = normalizePlanInput(data);

  // доп. кастомные метрики из body (id уже в колонках после POST /metrics)
  const extraKeys = Object.keys(data || {}).filter(
    (k) =>
      /^[a-z][a-z0-9_]{0,29}$/.test(k) &&
      !(METRICS as readonly string[]).includes(k) &&
      !['month', 'employee_id', 'id', 'credit'].includes(k)
  );
  for (const k of extraKeys) {
    (norm as any)[k] = num(data[k]);
  }

  // динамический upsert по METRICS
  const allCols = [...METRICS, ...extraKeys];
  const cols = ['employee_id', 'month', ...allCols];
  const vals: any[] = [employeeId, start, ...allCols.map((m) => num((norm as any)[m]))];
  const ph = cols.map((_, i) => `$${i + 1}`);
  const updates = allCols.map((m) => `${m} = EXCLUDED.${m}`).join(', ');

  try {
    const res = await query(
      `INSERT INTO employee_month_plans (${cols.join(', ')})
       VALUES (${ph.join(', ')})
       ON CONFLICT (employee_id, month) DO UPDATE SET
         ${updates},
         updated_at = now()
       RETURNING *`,
      vals
    );
    return res.rows[0];
  } catch (e: any) {
    // нет UNIQUE / нет колонок — пробуем update+insert
    console.error('upsertEmployeeMonthPlan:', e?.message || e);
    const existing = await query(
      `SELECT id FROM employee_month_plans WHERE employee_id = $1 AND month = $2::date`,
      [employeeId, start]
    ).catch(() => ({ rows: [] as any[] }));

    if (existing.rows[0]) {
      const set = METRICS.map((m, i) => `${m} = $${i + 3}`).join(', ');
      const res = await query(
        `UPDATE employee_month_plans SET ${set}
         WHERE employee_id = $1 AND month = $2::date
         RETURNING *`,
        [employeeId, start, ...METRICS.map((m) => norm[m])]
      );
      return res.rows[0];
    }

    const res = await query(
      `INSERT INTO employee_month_plans (${cols.join(', ')})
       VALUES (${ph.join(', ')})
       RETURNING *`,
      vals
    );
    return res.rows[0];
  }
}

export async function getMonthSummaryTable(month: string, orgId?: string) {
  const start = monthStart(month);
  const employees = await query(
    `SELECT id, full_name, short_name, role FROM employees
     WHERE COALESCE(is_active, true) = true AND COALESCE(org_id, 'default') = $1
     ORDER BY full_name`,
    [orgId || 'default']
  );

  const rows = [];
  const totalsFact: Record<string, number> = {};
  const totalsPlan: Record<string, number> = {};
  for (const m of METRICS) {
    totalsFact[m] = 0;
    totalsPlan[m] = 0;
  }

  for (const e of employees.rows) {
    const fact = await getEmployeeMonthFacts(Number(e.id), month);
    const planRow = await getEmployeeMonthPlan(Number(e.id), month);
    const shifts = await getEmployeeShiftCount(Number(e.id), month);
    const remainingShifts = await getEmployeeRemainingShifts(Number(e.id), month);

    const plan: Record<string, number> = {};
    const pct: Record<string, number> = {};
    for (const m of METRICS) {
      plan[m] = num(planRow?.[m]);
      const f = num(fact[m]);
      pct[m] = plan[m] > 0 ? Math.round((f / plan[m]) * 100) : f > 0 ? 100 : 0;
      totalsFact[m] += f;
      totalsPlan[m] += plan[m];
    }

    const perShift: Record<string, number> = {};
    const div = shifts > 0 ? shifts : daysInMonth(month);
    for (const m of METRICS) {
      perShift[m] = div > 0 ? Math.ceil(plan[m] / div) : 0;
    }

    rows.push({
      employee_id: e.id,
      full_name: e.full_name,
      short_name: e.short_name,
      role: e.role,
      fact,
      plan,
      pct,
      shifts,
      remaining_shifts: remainingShifts,
      per_shift: perShift
    });
  }

  const totalsPct: Record<string, number> = {};
  for (const m of METRICS) {
    totalsPct[m] =
      totalsPlan[m] > 0
        ? Math.round((totalsFact[m] / totalsPlan[m]) * 100)
        : totalsFact[m] > 0
          ? 100
          : 0;
  }

  return {
    month: start.slice(0, 7),
    metrics: [...METRICS],
    rows,
    totals: { fact: totalsFact, plan: totalsPlan, pct: totalsPct },
    remaining_days: remainingDaysInMonth(month)
  };
}

export async function getEmployeeDailyPlan(employeeId: number, date: string) {
  const month = date.slice(0, 7);
  const planRow = await getEmployeeMonthPlan(employeeId, month);
  if (!planRow) {
    const empty: Record<string, number> = {};
    for (const m of METRICS) empty[m] = 0;
    return { date, employee_id: employeeId, plan: empty, remaining_shifts: 0 };
  }

  const fact = await getEmployeeMonthFacts(employeeId, month);
  const remainingShifts = await getEmployeeRemainingShifts(employeeId, month);
  const div = remainingShifts > 0 ? remainingShifts : 1;

  const plan: Record<string, number> = {};
  for (const m of METRICS) {
    const left = Math.max(0, num(planRow[m]) - num(fact[m]));
    plan[m] = Math.ceil(left / div);
  }

  return {
    date,
    employee_id: employeeId,
    plan,
    remaining_shifts: remainingShifts,
    fact
  };
}

export async function computeStoreDailyPlans(date?: string, orgId?: string) {
  const d = date || todayMoscow();
  const month = d.slice(0, 7);
  const remainingDays = Math.max(1, remainingDaysInMonth(month));
  const org = orgId || 'default';

  // сумма остатков планов сотрудников СВОЕЙ сети / оставшиеся дни
  const employees = await query(
    `SELECT id FROM employees WHERE COALESCE(is_active, true) = true AND COALESCE(org_id, 'default') = $1`,
    [org]
  );

  const pool: Record<string, number> = {};
  for (const m of METRICS) pool[m] = 0;

  for (const e of employees.rows) {
    const planRow = await getEmployeeMonthPlan(Number(e.id), month);
    if (!planRow) continue;
    const fact = await getEmployeeMonthFacts(Number(e.id), month);
    for (const m of METRICS) {
      pool[m] += Math.max(0, num(planRow[m]) - num(fact[m]));
    }
  }

  const dailyPool: Record<string, number> = {};
  for (const m of METRICS) {
    dailyPool[m] = Math.ceil(pool[m] / remainingDays);
  }

  // точки своей сети (раньше тут был хардкод STORE_SHARES на 3 точки —
  // stores.plan_share уже был в схеме и даже подправлен вручную в БД, но
  // код его не читал; теперь доли берутся из колонки, а не из кода).
  const storesRes = await query(
    `SELECT id, name, code, plan_share FROM stores WHERE COALESCE(org_id, 'default') = $1 ORDER BY name`,
    [org]
  );
  const storeList = storesRes.rows;

  // shares: известные (plan_share > 0), остальные — поровну от остатка
  const known = new Map(
    storeList.filter((s: any) => Number(s.plan_share) > 0).map((s: any) => [s.id, Number(s.plan_share)])
  );
  const unknown = storeList.filter((s: any) => !known.has(s.id));
  const knownSum = [...known.values()].reduce((a: number, b: number) => a + b, 0);
  const rest = Math.max(0, 1 - knownSum);
  const equal = unknown.length ? rest / unknown.length : 0;

  const stores = storeList.map((st: any) => {
    const share = known.get(st.id) ?? (equal || (storeList.length ? 1 / storeList.length : 0));
    const plan: Record<string, number> = {};
    for (const m of METRICS) {
      plan[m] = Math.ceil(dailyPool[m] * share);
    }
    return {
      store_id: st.id,
      name: st.name,
      code: st.code,
      share,
      plan
    };
  });

  return {
    date: d,
    month,
    remaining_days: remainingDays,
    daily_pool: dailyPool,
    stores
  };
}

export async function materializeStoreDailyPlans(date?: string) {
  const d = date || todayMoscow();
  await query(`DELETE FROM store_plans WHERE plan_date = $1::date`, [d]);

  // Пул считается ОТДЕЛЬНО на каждую сеть — иначе план одной сети размывался
  // бы остатками другой (и делился бы между чужими точками).
  const orgsRes = await query(`SELECT id FROM organizations`);
  const orgIds = orgsRes.rows.length ? orgsRes.rows.map((r: any) => r.id) : ['default'];

  let allStores: any[] = [];
  for (const org of orgIds) {
    const computed = await computeStoreDailyPlans(d, org);
    allStores = allStores.concat(computed.stores);
  }

  for (const st of allStores) {
    const p = st.plan;
    try {
      await query(
        `INSERT INTO store_plans (
           store_id, plan_date,
           sim, mnp, pa, combo, phones, accessories, focus, settings,
           wink, shpd, insurance, credit_request, credit_issued, plotter, hb
         ) VALUES (
           $1,$2::date,
           $3,$4,$5,$6,$7,$8,$9,$10,
           $11,$12,$13,$14,$15,$16,$17
         )`,
        [
          st.store_id,
          d,
          num(p.sim),
          num(p.mnp),
          num(p.pa),
          num(p.combo),
          num(p.phones),
          num(p.accessories),
          num(p.focus),
          num(p.settings),
          num(p.wink),
          num(p.shpd),
          num(p.insurance),
          num(p.credit_request),
          num(p.credit_issued),
          num(p.plotter),
          num(p.hb)
        ]
      );
    } catch (e: any) {
      // fallback без новых колонок
      console.error('materialize insert', st.store_id, e?.message || e);
      await query(
        `INSERT INTO store_plans (
           store_id, plan_date,
           sim, mnp, pa, combo, phones, accessories, focus, settings,
           wink, shpd, insurance, credit_issued
         ) VALUES (
           $1,$2::date,
           $3,$4,$5,$6,$7,$8,$9,$10,
           $11,$12,$13,$14
         )`,
        [
          st.store_id,
          d,
          num(p.sim),
          num(p.mnp),
          num(p.pa),
          num(p.combo),
          num(p.phones),
          num(p.accessories),
          num(p.focus),
          num(p.settings),
          num(p.wink),
          num(p.shpd),
          num(p.insurance),
          num(p.credit_issued)
        ]
      );
    }
  }

  return { date: d, month: d.slice(0, 7), stores: allStores };
}

export { monthStart, remainingDaysInMonth };
