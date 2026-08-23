import { todayMoscow } from '../../utils/date.js';
import * as repo from '../../data/repositories/live-map.js';

function num(v: any) {
  return Number(v) || 0;
}

/** Live-снимок сети: кто на смене, % плана, касса, статус — только своей сети */
export async function getLiveNetworkMap(orgId = 'default') {
  const today = todayMoscow();

  const stores = await repo.listActiveStoresForOrg(orgId);

  const result = [];

  for (const st of stores) {
    const sessions = await repo.findOpenSessions(st.id, today);

    // fallback: график на сегодня если сессий нет
    let staff = sessions;
    if (!staff.length) {
      const sch = await repo.findScheduledStaff(st.id, today);
      staff = sch.map((r: any) => ({ ...r, status: 'scheduled' }));
    }

    const fact = await repo.findTodaySales(st.id, today);

    const plan = await repo.findTodayOrTemplatePlan(st.id, today);

    const keyPlan = num(plan.sim) + num(plan.mnp) + num(plan.pa) + num(plan.combo);
    const keyFact = num(fact.sim) + num(fact.mnp) + num(fact.pa) + num(fact.combo);
    const pct = keyPlan > 0 ? Math.round((keyFact / keyPlan) * 100) : 0;

    const cashRow = await repo.findTodayCash(st.id, today);
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
