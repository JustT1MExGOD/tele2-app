import { query } from '../db/index.js';

function num(v: any) {
  return Number(v) || 0;
}

export async function calculateBFQ(employeeId: number, month: string) {
  const start = month;
  const endDate = new Date(month);
  endDate.setMonth(endDate.getMonth() + 1);
  const end = endDate.toISOString().slice(0, 10);

  // Факт за месяц
  const factRes = await query(
    `SELECT 
       COALESCE(SUM(sim),0) as sim,
       COALESCE(SUM(mnp),0) as mnp,
       COALESCE(SUM(pa),0) as pa,
       COALESCE(SUM(combo),0) as combo,
       COALESCE(SUM(phones),0) as phones,
       COALESCE(SUM(accessories),0) as accessories,
       COALESCE(SUM(insurance),0) as insurance,
       COALESCE(SUM(wink),0) as wink,
       COALESCE(SUM(shpd),0) as shpd,
       COALESCE(SUM(focus),0) as focus
     FROM sales
     WHERE employee_id = $1 AND sale_date >= $2 AND sale_date < $3`,
    [employeeId, start, end]
  );
  const fact = factRes.rows[0] || {};

  // План (берём любой доступный)
  const planRes = await query(
    `SELECT * FROM store_plans WHERE plan_date IS NULL LIMIT 1`
  );
  const plan = planRes.rows[0] || {};

  // VMR
  const manualRes = await query(
    `SELECT vmr_avg, penalty FROM bfq_manual
     WHERE employee_id = $1 AND month = $2`,
    [employeeId, start]
  );
  const vmr = num(manualRes.rows[0]?.vmr_avg);
  const penalty = num(manualRes.rows[0]?.penalty);

  // Простые проценты
  const simPct = plan.sim ? num(fact.sim) / num(plan.sim) : 0;
  const mnpPct = plan.mnp ? num(fact.mnp) / num(plan.mnp) : 0;
  const paPct = plan.pa ? num(fact.pa) / num(plan.pa) : 0;

  // Упрощённый BFQ
  let score = 0;

  // GI блок (до 50)
  if (simPct >= 0.95) score += Math.min(simPct, 1.15) * 25;
  if (mnpPct >= 1) score += 25;
  else if (mnpPct > 0) score += 20;

  // VMR (до 12)
  if (vmr >= 95) score += 12;
  else if (vmr >= 77) score += 10;
  else if (vmr >= 74) score += 5;

  // Прибыль
  if (paPct >= 0.9) score += 5;
  if (num(fact.phones) > 0) score += 3;
  if (num(fact.accessories) > 0) score += 2;

  score -= penalty;

  return {
    total: Math.round(score * 10) / 10,
    sim: num(fact.sim),
    mnp: num(fact.mnp),
    pa: num(fact.pa),
    phones: num(fact.phones),
    vmr,
    penalty
  };
}
