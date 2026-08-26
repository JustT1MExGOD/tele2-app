/**
 * Месячные планы → дневные → планы точек
 * Единый список метрик (как в sales / frontend)
 *
 * 20.8.0 (Full DAL): весь SQL переехал в repositories/plans.ts (таблицы
 * планов) и repositories/sales.ts, repositories/employees.ts,
 * repositories/schedules.ts, repositories/stores.ts,
 * repositories/organizations.ts (факты/справочники) — этот файл остаётся
 * бизнес-логикой: нормализация ввода, выбор колонок, композиция.
 */
import { getMetricIds } from '../shared/metrics-catalog.js';
import * as plansRepo from '../../data/repositories/plans.js';
import * as salesRepo from '../../data/repositories/sales.js';
import * as employeesRepo from '../../data/repositories/employees.js';
import * as schedulesRepo from '../../data/repositories/schedules.js';
import * as storesRepo from '../../data/repositories/stores.js';
import * as orgsRepo from '../../data/repositories/organizations.js';

export const METRICS = plansRepo.METRICS;
export type Metric = plansRepo.Metric;

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

  // 1) Базовый запрос — всегда, без «лишних» колонок
  const BASE = [
    'sim', 'mnp', 'pa', 'combo', 'phones', 'accessories',
    'focus', 'settings', 'wink', 'shpd', 'insurance',
    'credit_request', 'credit_issued', 'plotter', 'hb'
  ] as const;

  const out: Record<string, number> = {};
  for (const m of METRICS) out[m] = 0;

  try {
    const cols = await salesRepo.getSalesColumns();
    const sumCols = BASE.filter((c) => cols.has(c));
    if (!sumCols.length) {
      // совсем старая схема
      const row = await salesRepo.sumVeryOldSchemaForEmployeeMonth(employeeId, start, end);
      for (const k of Object.keys(row)) out[k] = num(row[k]);
      return out;
    }

    const row = await salesRepo.sumColumnsForEmployeeMonth(employeeId, start, end, [...sumCols]);
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
      try {
        const row2 = await salesRepo.sumColumnsForEmployeeMonth(employeeId, start, end, extra);
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
      const row = await salesRepo.sumMinimalForEmployeeMonth(employeeId, start, end);
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
  return schedulesRepo.countWorkedInRange(employeeId, start, end);
}

export async function getEmployeeRemainingShifts(employeeId: number, month: string) {
  const today = todayMoscow();
  const end = monthEndExclusive(month);
  return schedulesRepo.countWorkedInRange(employeeId, today, end);
}

export async function getEmployeeMonthPlan(employeeId: number, month: string) {
  const start = monthStart(month);
  const row = await plansRepo.findEmployeeMonthPlanRow(employeeId, start);
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
  const updates = allCols.map((m) => `${m} = EXCLUDED.${m}`).join(', ');

  return plansRepo.upsertEmployeeMonthPlanRow(employeeId, start, cols, vals, updates, norm);
}

/**
 * План точки на месяц — вносится вручную (не выводится из суммы планов
 * сотрудников через долю, как раньше в computeStoreDailyPlans). Хранится
 * отдельно от планов сотрудников: это независимые друг от друга вещи.
 */
export async function getStoreMonthPlan(storeId: string, month: string) {
  const start = monthStart(month);
  const row = await plansRepo.findStoreMonthPlanRow(storeId, start);
  if (!row) return null;
  const plan: Record<string, any> = { ...row };
  if (plan.credit != null && plan.credit_issued == null) plan.credit_issued = plan.credit;
  for (const m of METRICS) if (plan[m] == null) plan[m] = 0;
  return plan;
}

export async function upsertStoreMonthPlan(storeId: string, month: string, data: Record<string, number>) {
  const start = monthStart(month);
  const norm = normalizePlanInput(data);
  return plansRepo.upsertStoreMonthPlanRow(storeId, start, norm);
}

/** Факт точки за месяц — сумма продаж всех сотрудников на этой точке (не только своей сети — подмена тоже считается). */
export async function getStoreMonthFacts(storeId: string, month: string) {
  const start = monthStart(month);
  const end = monthEndExclusive(month);
  const out: Record<string, number> = {};
  for (const m of METRICS) out[m] = 0;
  try {
    const cols = await salesRepo.getSalesColumns();
    const sumCols = (METRICS as readonly string[]).filter((c) => cols.has(c));
    const row = await salesRepo.sumColumnsForStoreMonth(storeId, start, end, sumCols);
    for (const c of sumCols) out[c] = num(row[c]);
  } catch (e) {
    console.error('getStoreMonthFacts failed:', (e as any)?.message || e);
  }
  return out;
}

export async function getMonthSummaryTable(month: string, orgId?: string) {
  const start = monthStart(month);
  const employees = await employeesRepo.listBasicByOrg(orgId || 'default');

  const rows = [];
  const totalsFact: Record<string, number> = {};
  const totalsPlan: Record<string, number> = {};
  for (const m of METRICS) {
    totalsFact[m] = 0;
    totalsPlan[m] = 0;
  }

  for (const e of employees) {
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

/** Та же сводная таблица, что getMonthSummaryTable(), но разбивка по точкам,
 * не по сотрудникам — getStoreMonthFacts()/getStoreMonthPlan() уже
 * существовали (карточка точки, редактирование плана точки), не хватало
 * только агрегата по всей сети сразу. totals здесь — сумма ПЛАНОВ ТОЧЕК,
 * не планов сотрудников (это разные, независимо задаваемые цели — числа
 * планов могут не совпадать с totals из getMonthSummaryTable, это ожидаемо,
 * не баг сверки). */
export async function getStoreMonthSummaryTable(month: string, orgId?: string) {
  const start = monthStart(month);
  const stores = await storesRepo.listActiveBasic(orgId || 'default');

  const rows = [];
  const totalsFact: Record<string, number> = {};
  const totalsPlan: Record<string, number> = {};
  for (const m of METRICS) {
    totalsFact[m] = 0;
    totalsPlan[m] = 0;
  }

  for (const s of stores) {
    const fact = await getStoreMonthFacts(s.id, month);
    const planRow = await getStoreMonthPlan(s.id, month);

    const plan: Record<string, number> = {};
    const pct: Record<string, number> = {};
    for (const m of METRICS) {
      plan[m] = num(planRow?.[m]);
      const f = num(fact[m]);
      pct[m] = plan[m] > 0 ? Math.round((f / plan[m]) * 100) : f > 0 ? 100 : 0;
      totalsFact[m] += f;
      totalsPlan[m] += plan[m];
    }

    rows.push({
      store_id: s.id,
      name: s.name,
      code: s.code,
      fact,
      plan,
      pct
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

/**
 * Дневной план точки = (месячный план точки − факт точки с начала месяца) /
 * оставшиеся дни — вручную внесённый план точки (store_month_plans), без
 * долевого распределения суммы планов сотрудников (было раньше — убрали
 * по просьбе: план точки теперь вносится напрямую и независимо от планов
 * сотрудников).
 */
export async function computeStoreDailyPlans(date?: string, orgId?: string) {
  const d = date || todayMoscow();
  const month = d.slice(0, 7);
  const remainingDays = Math.max(1, remainingDaysInMonth(month));
  const org = orgId || 'default';

  const storeList = await storesRepo.listBasicForOrg(org);

  const stores = [];
  for (const st of storeList) {
    const planRow = await getStoreMonthPlan(st.id, month);
    const fact = await getStoreMonthFacts(st.id, month);
    const plan: Record<string, number> = {};
    for (const m of METRICS) {
      const monthly = planRow ? num(planRow[m]) : 0;
      const remaining = Math.max(0, monthly - num(fact[m]));
      plan[m] = Math.ceil(remaining / remainingDays);
    }
    stores.push({
      store_id: st.id,
      name: st.name,
      code: st.code,
      has_plan: !!planRow,
      plan
    });
  }

  return {
    date: d,
    month,
    remaining_days: remainingDays,
    stores
  };
}

/**
 * 19.24.0 — per-store UPSERT (UNIQUE(store_id, plan_date), миграция 0013) —
 * атомарно на уровне строки, без пустого окна между DELETE и повторным
 * INSERT (см. repositories/plans.ts::materializeRow).
 */
export async function materializeStoreDailyPlans(date?: string) {
  const d = date || todayMoscow();

  // Пул считается ОТДЕЛЬНО на каждую сеть — иначе план одной сети размывался
  // бы остатками другой (и делился бы между чужими точками).
  const orgIds0 = await orgsRepo.listIds();
  const orgIds = orgIds0.length ? orgIds0 : ['default'];

  let allStores: any[] = [];
  for (const org of orgIds) {
    const computed = await computeStoreDailyPlans(d, org);
    allStores = allStores.concat(computed.stores);
  }

  for (const st of allStores) {
    await plansRepo.materializeRow(st.store_id, d, st.plan);
  }

  return { date: d, month: d.slice(0, 7), stores: allStores };
}

export { monthStart, remainingDaysInMonth };
