/**
 * План/факт дня для сотрудника — раньше считался только внутри
 * /shifts/close, теперь переиспользуется и в open/current (18.7, Shift 2.0)
 * для живого прогресса «до»/«во время» смены. Формула не менялась,
 * перенесена как есть из routes-shifts.ts.
 */
import * as salesRepo from '../../data/repositories/sales.js';
import * as plansRepo from '../../data/repositories/plans.js';
import * as schedulesRepo from '../../data/repositories/schedules.js';

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
  const factRow = await salesRepo.sumDayFactNarrow(employeeId, date);
  const fact: DayMetrics = {
    sim: num(factRow.sim),
    mnp: num(factRow.mnp),
    pa: num(factRow.pa),
    combo: num(factRow.combo)
  };

  const month = date.slice(0, 7) + '-01';
  const mp = (await plansRepo.findEmployeeMonthPlanExact(employeeId, month)) || {};
  const remCnt = await schedulesRepo.countRemainingInMonth(employeeId, date, month);
  const div = Math.max(1, num(remCnt));
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
