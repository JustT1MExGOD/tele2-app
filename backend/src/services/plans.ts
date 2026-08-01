/**
 * Месячные планы сотрудников → дневные планы → планы точек
 *
 * Логика:
 * 1. Manager задаёт employee_month_plans на месяц
 * 2. Дневной план сотрудника = month_plan / shifts_in_month
 *    (если смен 0 — делим на рабочие дни месяца как fallback)
 * 3. Суммарный остаток планов всех сотрудников на оставшиеся дни
 *    daily_pool = remaining_plan_total / remaining_days
 * 4. На точки: 50% kosmonavtov, 30% kalinina11, 20% kalinina2
 */

import { query } from '../db/index.js';

const METRICS = [
  'sim', 'mnp', 'pa', 'combo', 'phones', 'accessories',
  'focus', 'settings', 'wink', 'shpd', 'insurance', 'credit', 'plotter', 'hb'
] as const;

export type Metric = (typeof METRICS)[number];

function num(v: any) {
  return Number(v) || 0;
}

function monthStart(month: string) {
  // '2026-08' or '2026-08-01'
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
  // inclusive remaining: today..last day
  const last = new Date(end + 'T12:00:00');
  last.setDate(last.getDate() - 1);
  const t = new Date(today + 'T12:00:00');
  return Math.max(0, Math.round((last.getTime() - t.getTime()) / 86400000) + 1);
}

/** Факт продаж сотрудника за месяц */
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
       COALESCE(SUM(credit_issued),0) as credit,
       COALESCE(SUM(plotter),0) as plotter,
       COALESCE(SUM(hb),0) as hb
     FROM sales
     WHERE employee_id = $1 AND sale_date >= $2 AND sale_date < $3`,
    [employeeId, start, end]
  );
  return res.rows[0] || {};
}

/** Число смен сотрудника в месяце */
export async function getEmployeeShiftCount(employeeId: number, month: string) {
  const start = monthStart(month);
  const end = monthEndExclusive(month);
  const res = await query(
    `SELECT COUNT(*)::int as cnt
     FROM schedules
     WHERE employee_id = $1 AND work_date >= $2 AND work_date < $3 AND hours > 0`,
    [employeeId, start, end]
  );
  return num(res.rows[0]?.cnt);
}

/** Смены оставшиеся (включая сегодня) */
export async function getEmployeeRemainingShifts(employeeId: number, month: string) {
  const today = todayMoscow();
  const end = monthEndExclusive(month);
  const res = await query(
    `SELECT COUNT(*)::int as cnt
     FROM schedules
     WHERE employee_id = $1 AND work_date >= $2 AND work_date < $3 AND hours > 0`,
    [employeeId, today, end]
  );
  return num(res.rows[0]?.cnt);
}

export async function getEmployeeMonthPlan(employeeId: number, month: string) {
  const start = monthStart(month);
  const res = await query(
    `SELECT * FROM employee_month_plans WHERE employee_id = $1 AND month = $2`,
    [employeeId, start]
  );
  return res.rows[0] || null;
}

export async function upsertEmployeeMonthPlan(
  employeeId: number,
  month: string,
  data: Record<string, number>
) {
  const start = monthStart(month);
  const cols = METRICS;
  const values = cols.map((c) => num(data[c]));
  const placeholders = cols.map((_, i) => `$${i + 3}`).join(',');
  const updates = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');

  const res = await query(
    `INSERT INTO employee_month_plans (employee_id, month, ${cols.join(', ')}, updated_at)
     VALUES ($1, $2, ${placeholders}, now())
     ON CONFLICT (employee_id, month)
     DO UPDATE SET ${updates}, updated_at = now()
     RETURNING *`,
    [employeeId, start, ...values]
  );
  return res.rows[0];
}

/**
 * Сводка «как таблица 2»: все сотрудники, факт за месяц, план, %
 */
export async function getMonthSummaryTable(month: string) {
  const start = monthStart(month);
  const emps = await query(
    `SELECT id, full_name, short_name, role
     FROM employees WHERE is_active = true ORDER BY full_name`
  );

  const rows = [];
  const totalsFact: Record<string, number> = {};
  const totalsPlan: Record<string, number> = {};
  for (const m of METRICS) {
    totalsFact[m] = 0;
    totalsPlan[m] = 0;
  }

  for (const e of emps.rows) {
    const fact = await getEmployeeMonthFacts(Number(e.id), month);
    const planRow = await getEmployeeMonthPlan(Number(e.id), month);
    const shifts = await getEmployeeShiftCount(Number(e.id), month);
    const remainingShifts = await getEmployeeRemainingShifts(Number(e.id), month);

    const plan: Record<string, number> = {};
    const pct: Record<string, number> = {};
    for (const m of METRICS) {
      plan[m] = num(planRow?.[m]);
      const f = num(fact[m]);
      pct[m] = plan[m] > 0 ? Math.round((f / plan[m]) * 100) : (f > 0 ? 100 : 0);
      totalsFact[m] += f;
      totalsPlan[m] += plan[m];
    }

    // дневной план на смену
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

/**
 * Дневной план сотрудника на конкретную дату
 * = остаток плана / оставшиеся смены
 */
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
    month_plan: planRow,
    month_fact: fact
  };
}

/** Доли точек по умолчанию, если plan_share в БД = 0 / NULL */
const DEFAULT_SHARES: Record<string, number> = {
  kosmonavtov: 0.5,
  kalinina11: 0.3,
  kalinina2: 0.2
};

function storeShare(st: { id: string; plan_share?: any }) {
  const fromDb = num(st.plan_share);
  if (fromDb > 0) return fromDb;
  return DEFAULT_SHARES[st.id] ?? 0;
}

/**
 * Дневные планы точек:
 * 1) Остатки месячных планов всех сотрудников (план − факт)
 * 2) Делим на remaining_days → пул на день (ceil)
 * 3) Размазываем по точкам: plan_share (50/30/20), ceil
 */
export async function computeStoreDailyPlans(date?: string) {
  const d = date || todayMoscow();
  const month = d.slice(0, 7);
  const remainingDays = remainingDaysInMonth(month);
  const div = remainingDays > 0 ? remainingDays : 1;

  const emps = await query(
    `SELECT id FROM employees WHERE COALESCE(is_active, true) = true`
  );

  const pool: Record<string, number> = {};
  for (const m of METRICS) pool[m] = 0;

  let employeesWithPlan = 0;
  for (const e of emps.rows) {
    const planRow = await getEmployeeMonthPlan(Number(e.id), month);
    if (!planRow) continue;
    employeesWithPlan += 1;
    const fact = await getEmployeeMonthFacts(Number(e.id), month);
    for (const m of METRICS) {
      // credit в employee_month_plans, credit_issued в sales — уже замаплено в getEmployeeMonthFacts как credit
      pool[m] += Math.max(0, num(planRow[m]) - num(fact[m]));
    }
  }

  const daily: Record<string, number> = {};
  for (const m of METRICS) {
    daily[m] = Math.ceil(pool[m] / div);
  }

  const stores = await query(
    `SELECT id, name, code, color, plan_share
     FROM stores
     WHERE COALESCE(is_active, true) = true
     ORDER BY id`
  );

  // Нормализуем доли, если сумма > 0 (на случай кастомных долей)
  let shareSum = 0;
  const shares: Record<string, number> = {};
  for (const st of stores.rows) {
    shares[st.id] = storeShare(st);
    shareSum += shares[st.id];
  }
  if (shareSum <= 0) {
    // fallback: поровну
    const n = Math.max(1, stores.rows.length);
    for (const st of stores.rows) shares[st.id] = 1 / n;
    shareSum = 1;
  }

  const result = stores.rows.map((st: any) => {
    const share = shares[st.id] / (shareSum || 1);
    const plan: Record<string, number> = {};
    for (const m of METRICS) {
      plan[m] = Math.ceil(daily[m] * share);
    }
    return {
      store_id: st.id,
      name: st.name,
      code: st.code,
      color: st.color,
      plan_share: Math.round(share * 1000) / 1000,
      plan
    };
  });

  return {
    date: d,
    month: month,
    remaining_days: remainingDays,
    employees_with_plan: employeesWithPlan,
    pool_remaining: pool,
    daily_total: daily,
    stores: result
  };
}

/**
 * Записать дневные планы точек в store_plans на дату.
 * Удаляем старые строки за эту дату и вставляем заново (надёжнее ON CONFLICT).
 * Шаблон plan_date IS NULL не трогаем.
 */
export async function materializeStoreDailyPlans(date?: string) {
  const computed = await computeStoreDailyPlans(date);
  const d = computed.date;

  // убрать предыдущую материализацию на этот день
  await query(
    `DELETE FROM store_plans WHERE plan_date = $1`,
    [d]
  );

  for (const st of computed.stores) {
    const p = st.plan;
    await query(
      `INSERT INTO store_plans (
         store_id, plan_date,
         sim, mnp, pa, combo, phones, accessories, focus, settings,
         wink, shpd, insurance, credit_issued, plotter, hb
       ) VALUES (
         $1,$2,
         $3,$4,$5,$6,$7,$8,$9,$10,
         $11,$12,$13,$14,$15,$16
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
        num(p.credit), // credit → credit_issued
        num(p.plotter),
        num(p.hb)
      ]
    );
  }

  return computed;
}

export { METRICS, monthStart, remainingDaysInMonth };
