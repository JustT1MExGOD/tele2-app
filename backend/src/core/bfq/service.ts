/**
 * BFQ — полный расчёт как в старой Google-таблице (BFQ.gs)
 *
 * Качество = GI(50) + VMR(0..12) + Digital(25) + TopUp(15)
 * Прибыль  = PA + MNP + Аксы + Плоттер + Кредит
 * BFQ      = Качество + Прибыль − Штраф
 *
 * Прогноз: по отработанным/оставшимся сменам в месяце
 */

import { getEmployeeMonthPlan } from '../plans/service.js';
import * as repo from '../../data/repositories/bfq.js';

export const BFQ_CONFIG = {
  comboBoostExtra: 4,    // факт комбо >= план + 4
  comboBoostCoef: 1.15,
  creditSharePercent: 10 // доля КВ → множитель top-up
};

function num(v: any) {
  return Number(v) || 0;
}

function round1(v: number) {
  return Math.round(v * 10) / 10;
}

function officialGICoeff(pct: number) {
  const value = num(pct);
  if (value < 0.95) return 0;
  if (value >= 1.15) return 1.15;
  return value;
}

function officialMNPCoeff(pct: number) {
  const value = num(pct);
  if (value < 1) return 0.8;
  if (value >= 1.1) return 1.1;
  return 1;
}

function linearCoeff(pct: number, min: number, max: number) {
  const value = num(pct);
  if (value < min) return 0;
  if (value >= max) return max;
  return value;
}

function averagePositive(arr: number[]) {
  const values = arr.map(num).filter((v) => v > 0);
  if (!values.length) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function creditCoef(percent: number) {
  const value = num(percent);
  if (value <= 0) return 1;
  if (value <= 5) return 1.05;
  if (value <= 10) return 1.3;
  return 1.5;
}

function calcGIBlock(pct: Record<string, number>) {
  const giCoeff = officialGICoeff(pct.sim);
  const mnpCoeff = officialMNPCoeff(pct.mnp);
  return 50 * ((giCoeff + mnpCoeff) / 2);
}

function calcVMRBlock(vmr: number) {
  const value = num(vmr);
  if (value >= 95) return 10 * 1.2;
  if (value >= 77) return 10;
  if (value >= 74) return 10 * 0.5;
  return 0;
}

function calcDigitalBlock(pct: Record<string, number>) {
  const digitalAvg = averagePositive([pct.focus, pct.settings, pct.wink]);
  const digitalCoeff = linearCoeff(digitalAvg, 0.8, 1.15);
  const shpdCoeff = linearCoeff(pct.shpd, 0.8, 1.0);

  let blockCoeff = digitalCoeff * 0.8 + shpdCoeff * 0.2;
  if (digitalCoeff === 0 || shpdCoeff === 0) {
    blockCoeff = blockCoeff * 0.5;
  }
  return 25 * blockCoeff;
}

function calcTopUpBlock(plan: Record<string, number>, pct: Record<string, number>) {
  const phoneCoeff = linearCoeff(pct.phones, 0.8, 1.1);
  const insuranceCoeff = linearCoeff(pct.insurance, 0.8, 1.5);
  const subscriptionCoeff = linearCoeff(pct.wink, 0.8, 1.1);

  if (phoneCoeff === 0 || insuranceCoeff === 0 || subscriptionCoeff === 0) {
    return 0;
  }

  let blockCoeff =
    phoneCoeff * 0.4 +
    insuranceCoeff * 0.4 +
    subscriptionCoeff * 0.2;

  const comboPlan = num(plan.combo);
  const comboFact = comboPlan * num(pct.combo);
  if (comboPlan > 0 && comboFact >= comboPlan + BFQ_CONFIG.comboBoostExtra) {
    blockCoeff = blockCoeff * BFQ_CONFIG.comboBoostCoef;
  }

  blockCoeff = blockCoeff * creditCoef(BFQ_CONFIG.creditSharePercent);
  return 15 * blockCoeff;
}

function calcProfit(pct: Record<string, number>) {
  let score = 0;
  if (num(pct.pa) >= 0.9) score += 5;
  if (num(pct.mnp) >= 1) score += 5;
  if (num(pct.accessories) >= 1) score += 3;
  if (num(pct.plotter) >= 1) score += 3;
  if (num(pct.credit) >= 1) score += 4;
  return score;
}

export function calculateBFQFromPct(
  plan: Record<string, number>,
  pct: Record<string, number>,
  vmr: number,
  penalty: number
) {
  const gi = calcGIBlock(pct);
  const vmrBlock = calcVMRBlock(vmr);
  const digital = calcDigitalBlock(pct);
  const topUp = calcTopUpBlock(plan, pct);
  const quality = gi + vmrBlock + digital + topUp;
  const profit = calcProfit(pct);
  const total = quality + profit - num(penalty);

  return {
    total: round1(total),
    quality: round1(quality),
    profit: round1(profit),
    blocks: {
      gi: round1(gi),
      vmr: round1(vmrBlock),
      digital: round1(digital),
      topUp: round1(topUp)
    },
    vmr: num(vmr),
    penalty: num(penalty),
    pct
  };
}

/** Прогноз % до конца месяца по сменам */
export function forecastByShifts(
  plan: Record<string, number>,
  pctFact: Record<string, number>,
  worked: number,
  remaining: number
) {
  const result: Record<string, number> = { ...pctFact };
  if (worked <= 0) return result;

  for (const key of Object.keys(plan)) {
    const monthlyPlan = num(plan[key]);
    const currentPct = num(pctFact[key]);
    if (monthlyPlan <= 0) {
      result[key] = currentPct;
      continue;
    }
    const currentFact = monthlyPlan * currentPct;
    const avgPerShift = currentFact / worked;
    const forecastFact = currentFact + avgPerShift * remaining;
    const forecastPct = forecastFact / monthlyPlan;
    result[key] = Math.max(currentPct, forecastPct);
  }
  return result;
}

async function getEmployeeMonthShifts(employeeId: number, month: string) {
  // month = YYYY-MM
  const start = `${month}-01`;
  const endDate = new Date(`${month}-01T12:00:00`);
  endDate.setMonth(endDate.getMonth() + 1);
  const end = endDate.toISOString().slice(0, 10);

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());

  const rows = await repo.findShiftsInRange(employeeId, start, end);

  let worked = 0;
  let remaining = 0;
  for (const row of rows) {
    const d = String(row.work_date).slice(0, 10);
    if (d <= today) worked++;
    else remaining++;
  }
  return { worked, remaining };
}

async function getEmployeeFacts(employeeId: number, month: string) {
  const start = `${month}-01`;
  const endDate = new Date(`${month}-01T12:00:00`);
  endDate.setMonth(endDate.getMonth() + 1);
  const end = endDate.toISOString().slice(0, 10);

  return repo.sumMonthFacts(employeeId, start, end);
}

function factsToPct(fact: any, plan: any): Record<string, number> {
  const keys = [
    'sim', 'mnp', 'pa', 'combo', 'phones', 'accessories',
    'focus', 'settings', 'wink', 'shpd', 'insurance', 'credit', 'plotter'
  ];
  const pct: Record<string, number> = {};
  for (const k of keys) {
    const p = num(plan[k]);
    const f = num(fact[k]);
    pct[k] = p > 0 ? f / p : (f > 0 ? 1 : 0);
  }
  return pct;
}

async function getManual(employeeId: number, month: string) {
  const start = `${month}-01`;
  const row = await repo.findManual(employeeId, start);
  return {
    vmr: num(row?.vmr_avg),
    penalty: num(row?.penalty)
  };
}

export async function calculateEmployeeBFQ(employeeId: number, month: string) {
  // Раньше план брался из store_plans WHERE plan_date IS NULL — строки,
  // которая создаётся РОВНО ОДИН РАЗ (нулями) при создании точки и никогда
  // больше нигде не обновляется ни одним из существующих эндпоинтов.
  // Реальный, живой план сотрудника — employee_month_plans, который
  // PUT /plans/employees/:id/month обновляет прямо сейчас — BFQ этот план
  // вообще не видел: правка плана никогда не отражалась в расчёте BFQ.
  const plan: Record<string, any> = (await getEmployeeMonthPlan(employeeId, month)) || {};
  // Остальной bfq.ts (factsToPct/calcProfit/calcTopUpBlock) читает
  // plan.credit — upsertEmployeeMonthPlan пишет только credit_issued,
  // колонка credit остаётся на DEFAULT 0 навсегда. Без этого моста план по
  // кредитам обнулился бы точно так же, как до фикса.
  plan.credit = num(plan.credit_issued);
  const fact = await getEmployeeFacts(employeeId, month);
  const pctFact = factsToPct(fact, plan);
  const { vmr, penalty } = await getManual(employeeId, month);
  const shifts = await getEmployeeMonthShifts(employeeId, month);

  const pctForecast = forecastByShifts(plan, pctFact, shifts.worked, shifts.remaining);

  const factCalc = calculateBFQFromPct(plan, pctFact, vmr, penalty);
  const forecastCalc = calculateBFQFromPct(plan, pctForecast, vmr, penalty);

  return {
    employee_id: employeeId,
    month,
    fact: factCalc,
    forecast: forecastCalc,
    shifts,
    plan: {
      sim: num(plan.sim), mnp: num(plan.mnp), pa: num(plan.pa),
      combo: num(plan.combo), phones: num(plan.phones),
      accessories: num(plan.accessories), focus: num(plan.focus),
      settings: num(plan.settings), wink: num(plan.wink),
      shpd: num(plan.shpd), insurance: num(plan.insurance),
      credit: num(plan.credit_issued ?? plan.credit), plotter: num(plan.plotter)
    },
    fact_raw: fact
  };
}

/** orgId обязателен — раньше без него отдавал BFQ вообще всех сетей
 * (routes-bfq.ts, routes-export.ts), теперь оба вызова обязаны его передать. */
export async function calculateAllBFQ(month: string, orgId: string) {
  const emps = await repo.listActiveEmployeesForOrg(orgId);

  const items = [];
  for (const e of emps) {
    const bfq = await calculateEmployeeBFQ(Number(e.id), month);
    items.push({
      employee_id: e.id,
      full_name: e.full_name,
      short_name: e.short_name,
      role: e.role,
      total: bfq.fact.total,
      forecast: bfq.forecast.total,
      quality: bfq.fact.quality,
      profit: bfq.fact.profit,
      vmr: bfq.fact.vmr,
      penalty: bfq.fact.penalty,
      blocks: bfq.fact.blocks,
      pct: bfq.fact.pct,
      shifts: bfq.shifts,
      sim: bfq.fact_raw.sim,
      mnp: bfq.fact_raw.mnp,
      pa: bfq.fact_raw.pa,
      phones: bfq.fact_raw.phones
    });
  }

  items.sort((a, b) => b.total - a.total);
  return items;
}

/** Сохранить VMR / штраф */
export async function upsertBFQManual(
  employeeId: number,
  month: string,
  vmrAvg: number,
  penalty: number
) {
  const start = `${month}-01`;
  return repo.upsertManual(employeeId, start, vmrAvg, penalty);
}

/** Добавить анкету VMR */
export async function addVMRQuestionnaire(
  employeeId: number,
  score: number,
  comment = ''
) {
  const created = await repo.insertQuestionnaire(employeeId, score, comment);

  // Пересчёт среднего VMR за текущий месяц
  const month = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit'
  }).format(new Date());
  const start = `${month}-01`;

  const avg = await repo.avgQuestionnaireScore(employeeId, start);
  const currentPenalty = await repo.findManualPenalty(employeeId, start);

  await upsertBFQManual(
    employeeId,
    month,
    num(avg),
    num(currentPenalty)
  );

  return created;
}
