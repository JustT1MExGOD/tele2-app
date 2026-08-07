import { query } from '../db/index.js';
import { todayMoscow } from '../utils/date.js';

function num(v: any) {
  return Number(v) || 0;
}

/** Live-снимок сети: кто на смене, % плана, касса, статус — только своей сети */
export async function getLiveNetworkMap(orgId = 'default') {
  const today = todayMoscow();

  const stores = await query(
    `SELECT id, name, code, color, lat, lng, plan_share
     FROM stores
     WHERE COALESCE(is_active, true) = true AND COALESCE(org_id,'default') = $1
     ORDER BY hours NULLS LAST, name`,
    [orgId]
  );

  const result = [];

  for (const st of stores.rows) {
    const sessions = await query(
      `SELECT ss.*, e.full_name, e.short_name
       FROM shift_sessions ss
       JOIN employees e ON e.id = ss.employee_id
       WHERE ss.store_id = $1 AND ss.work_date = $2::date AND ss.status = 'open'`,
      [st.id, today]
    );

    // fallback: график на сегодня если сессий нет
    let staff = sessions.rows;
    if (!staff.length) {
      const sch = await query(
        `SELECT sch.employee_id, sch.shift_text, sch.hours, e.full_name, e.short_name
         FROM schedules sch
         JOIN employees e ON e.id = sch.employee_id
         WHERE sch.store_id = $1 AND sch.work_date::date = $2::date AND COALESCE(sch.hours,0) > 0`,
        [st.id, today]
      );
      staff = sch.rows.map((r: any) => ({ ...r, status: 'scheduled' }));
    }

    const sales = await query(
      `SELECT COALESCE(SUM(sim),0) sim, COALESCE(SUM(mnp),0) mnp,
              COALESCE(SUM(pa),0) pa, COALESCE(SUM(combo),0) combo,
              COALESCE(SUM(phones),0) phones, COALESCE(SUM(accessories),0) accessories
       FROM sales WHERE store_id = $1 AND sale_date::date = $2::date`,
      [st.id, today]
    );
    const fact = sales.rows[0] || {};

    const planRes = await query(
      `SELECT sim, mnp, pa, combo, phones, accessories
       FROM store_plans
       WHERE store_id = $1 AND (plan_date = $2::date OR plan_date IS NULL)
       ORDER BY plan_date NULLS LAST
       LIMIT 1`,
      [st.id, today]
    );
    const plan = planRes.rows[0] || {};

    const keyPlan = num(plan.sim) + num(plan.mnp) + num(plan.pa) + num(plan.combo);
    const keyFact = num(fact.sim) + num(fact.mnp) + num(fact.pa) + num(fact.combo);
    const pct = keyPlan > 0 ? Math.round((keyFact / keyPlan) * 100) : 0;

    const cash = await query(
      `SELECT cash_fact, cash_1c, (cash_fact - (cash_1c + 2000)) as delta
       FROM store_cash WHERE store_id = $1 AND cash_date = $2::date`,
      [st.id, today]
    );
    const cashRow = cash.rows[0] || null;
    const cashGap = cashRow ? num(cashRow.delta) : null;

    let status: 'ok' | 'warn' | 'critical' = 'ok';
    if (pct < 40) status = 'warn';
    if (pct < 20 && staff.length) status = 'critical';
    if (cashGap != null && Math.abs(cashGap) >= 5000) status = 'critical';

    result.push({
      store_id: st.id,
      name: st.name,
      code: st.code,
      color: st.color,
      lat: st.lat,
      lng: st.lng,
      staff: staff.map((s: any) => ({
        employee_id: s.employee_id,
        full_name: s.full_name,
        short_name: s.short_name,
        shift_text: s.shift_text,
        status: s.status || 'open',
        opened_at: s.opened_at
      })),
      fact: {
        sim: num(fact.sim),
        mnp: num(fact.mnp),
        pa: num(fact.pa),
        combo: num(fact.combo),
        phones: num(fact.phones),
        accessories: num(fact.accessories)
      },
      plan: {
        sim: num(plan.sim),
        mnp: num(plan.mnp),
        pa: num(plan.pa),
        combo: num(plan.combo)
      },
      plan_pct: pct,
      cash: cashRow
        ? { fact: num(cashRow.cash_fact), c1: num(cashRow.cash_1c), delta: cashGap }
        : null,
      status
    });
  }

  return { date: today, stores: result };
}
