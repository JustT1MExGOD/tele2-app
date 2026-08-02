/**
 * Месячные планы → дневные → планы точек
 * Единый список метрик (как в sales / frontend)
 */
import { query } from '../db/index.js';

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

export async function getEmployeeMonthFacts(employeeId: number, month: string) {
  const start = monthStart(month);
  const end = monthEndExclusive(month);
  const res = await query(
    `SELECT
       COALESCE(SUM(sim),0) as sim,
       COALESCE(SUM(mnp),0) as mnp,
       COALESCE(SUM(pa),0) as pa,
       COALESCE(SUM(combo),0) as combo,
       COALESCE(SUM(phones),0) as phones,
       COALESCE(SUM(accessories),0) as accessories,
       COALESCE(SUM(focus),0) as focus,
       COALESCE(SUM(settings),0) as settings,
       COALESCE(SUM(wink),0) as wink,
       COALESCE(SUM(shpd),0) as shpd,
       COALESCE(SUM(insurance),0) as insurance,
       COALESCE(SUM(credit_request),0) as credit_request,
       COALESCE(SUM(credit_issued),0) as credit_issued,
       COALESCE(SUM(plotter),0) as plotter,
       COALESCE(SUM(hb),0) as hb
     FROM sales
     WHERE employee_id = $1
       AND sale_date >= $2::date
       AND sale_date < $3::date`,
    [employeeId, start, end]
  ).catch(async () => {
    // fallback без plotter/hb если колонок нет
    const r = await query(
      `SELECT
         COALESCE(SUM(sim),0) as sim, COALESCE(SUM(mnp),0) as mnp,
         COALESCE(SUM(pa),0) as pa, COALESCE(SUM(combo),0) as combo,
         COALESCE(SUM(phones),0) as phones, COALESCE(SUM(accessories),0) as accessories,
         COALESCE(SUM(focus),0) as focus, COALESCE(SUM(settings),0) as settings,
         COALESCE(SUM(wink),0) as wink, COALESCE(SUM(shpd),0) as shpd,
         COALESCE(SUM(insurance),0) as insurance,
         COALESCE(SUM(credit_request),0) as credit_request,
         COALESCE(SUM(credit_issued),0) as credit_issued
       FROM sales
       WHERE employee_id = $1 AND sale_date >= $2::date AND sale_date < $3::date`,
      [employeeId, start, end]
    );
    return { rows: [{ ...r.rows[0], plotter: 0, hb: 0 }] };
  });

  const row = res.rows[0] || {};
  const out: Record<string, number> = {};
  for (const m of METRICS) out[m] = num(row[m]);
  return out;
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

  // динамический upsert по METRICS
  const cols = ['employee_id', 'month', ...METRICS];
  const vals: any[] = [employeeId, start, ...METRICS.map((m) => norm[m])];
  const ph = cols.map((_, i) => `$${i + 1}`);
  const updates = METRICS.map((m) => `${m} = EXCLUDED.${m}`).join(', ');

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

export async function getMonthSummaryTable(month: string) {
  const start = monthStart(month);
  const employees = await query(
    `SELECT id, full_name, short_name, role FROM employees
     WHERE COALESCE(is_active, true) = true
     ORDER BY full_name`
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

const STORE_SHARES: { id: string; share: number }[] = [
  { id: 'kosmonavtov', share: 0.5 },
  { id: 'kalinina11', share: 0.3 },
  { id: 'kalinina2', share: 0.2 }
];

export async function computeStoreDailyPlans(date?: string) {
  const d = date || todayMoscow();
  const month = d.slice(0, 7);
  const remainingDays = Math.max(1, remainingDaysInMonth(month));

  // сумма остатков планов всех сотрудников / оставшиеся дни
  const employees = await query(
    `SELECT id FROM employees WHERE COALESCE(is_active, true) = true`
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

  // магазины из БД (чтобы новые точки тоже попадали)
  const storesRes = await query(`SELECT id, name, code FROM stores ORDER BY name`);
  const storeList = storesRes.rows.length
    ? storesRes.rows
    : STORE_SHARES.map((s) => ({ id: s.id, name: s.id, code: s.id }));

  // shares: known mapping, else equal split
  const known = new Map(STORE_SHARES.map((s) => [s.id, s.share]));
  const unknown = storeList.filter((s: any) => !known.has(s.id));
  const knownSum = storeList
    .filter((s: any) => known.has(s.id))
    .reduce((a: number, s: any) => a + (known.get(s.id) || 0), 0);
  const rest = Math.max(0, 1 - knownSum);
  const equal = unknown.length ? rest / unknown.length : 0;

  const stores = storeList.map((st: any) => {
    const share = known.get(st.id) ?? (equal || 1 / storeList.length);
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
  const computed = await computeStoreDailyPlans(date);
  const d = computed.date;

  await query(`DELETE FROM store_plans WHERE plan_date = $1::date`, [d]);

  for (const st of computed.stores) {
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

  return computed;
}

export { monthStart, remainingDaysInMonth };
