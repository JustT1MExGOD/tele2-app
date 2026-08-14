/**
 * План/факт дня для сотрудника — раньше считался только внутри
 * /shifts/close, теперь переиспользуется и в open/current (18.7, Shift 2.0)
 * для живого прогресса «до»/«во время» смены. Формула не менялась,
 * перенесена как есть из routes-shifts.ts.
 */
import { query } from '../db/index.js';

function num(v: any) {
  return Number(v) || 0;
}

export interface DayMetrics {
  sim: number;
  mnp: number;
  pa: number;
  combo: number;
  [key: string]: number;
}

export interface DayPlanFact {
  fact: DayMetrics;
  dayPlan: DayMetrics;
  factUnits: number;
  dayPlanUnits: number;
  planPct: number;
}

export async function computeDayPlanFact(employeeId: number, date: string): Promise<DayPlanFact> {
  const sales = await query(
    `SELECT COALESCE(SUM(sim),0) sim, COALESCE(SUM(mnp),0) mnp,
            COALESCE(SUM(pa),0) pa, COALESCE(SUM(combo),0) combo
     FROM sales WHERE employee_id = $1 AND sale_date::date = $2::date`,
    [employeeId, date]
  );
  const factRow = sales.rows[0] || {};
  const fact: DayMetrics = {
    sim: num(factRow.sim),
    mnp: num(factRow.mnp),
    pa: num(factRow.pa),
    combo: num(factRow.combo)
  };

  const month = date.slice(0, 7) + '-01';
  const planRow = await query(
    `SELECT sim, mnp, pa, combo FROM employee_month_plans
     WHERE employee_id = $1 AND month::date = $2::date`,
    [employeeId, month]
  );
  const rem = await query(
    `SELECT COUNT(*)::int c FROM schedules
     WHERE employee_id = $1 AND work_date::date >= $2::date
       AND work_date::date < ($3::date + interval '1 month') AND COALESCE(hours,0)>0`,
    [employeeId, date, month]
  );
  const div = Math.max(1, num(rem.rows[0]?.c));
  const mp = planRow.rows[0] || {};
  const dayPlan: DayMetrics = {
    sim: Math.ceil(num(mp.sim) / div),
    mnp: Math.ceil(num(mp.mnp) / div),
    pa: Math.ceil(num(mp.pa) / div),
    combo: Math.ceil(num(mp.combo) / div)
  };
  const dayPlanUnits = dayPlan.sim + dayPlan.mnp + dayPlan.pa + dayPlan.combo;
  const factUnits = fact.sim + fact.mnp + fact.pa + fact.combo;
  const planPct = dayPlanUnits > 0 ? Math.round((factUnits / dayPlanUnits) * 100) : 0;

  return { fact, dayPlan, factUnits, dayPlanUnits, planPct };
}
