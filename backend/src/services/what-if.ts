/**
 * What-if: виртуальный перенос смены → пересчёт покрытия плана точки.
 * Не пишет в БД — только симуляция.
 */
import { query } from '../db/index.js';
import { toDateISO, todayMoscow } from '../utils/date.js';

function n(v: any) {
  return Number(v) || 0;
}

const METRICS = ['sim', 'mnp', 'pa', 'combo'] as const;

async function perShiftPlan(employeeId: number, date: string) {
  const month = date.slice(0, 7) + '-01';
  const pr = await query(
    `SELECT sim, mnp, pa, combo FROM employee_month_plans
     WHERE employee_id = $1 AND month::date = $2::date LIMIT 1`,
    [employeeId, month]
  );
  const rem = await query(
    `SELECT COUNT(*)::int c FROM schedules
     WHERE employee_id = $1
       AND work_date::date >= $2::date
       AND work_date::date < ($3::date + interval '1 month')
       AND COALESCE(hours, 0) > 0`,
    [employeeId, date, month]
  );
  const div = Math.max(1, n(rem.rows[0]?.c));
  const row = pr.rows[0] || {};
  const out: Record<string, number> = {};
  for (const m of METRICS) out[m] = Math.ceil(n(row[m]) / div);
  return out;
}

export type WhatIfMove = {
  employee_id: number;
  from_store?: string | null;
  to_store: string;
  work_date?: string;
};

export async function simulateScheduleMoves(opts: {
  date?: string;
  moves: WhatIfMove[];
  orgId: string;
}) {
  const date = toDateISO(opts.date || todayMoscow());
  const moves = opts.moves || [];

  // Точки только своей сети — раньше тянулись ВСЕ активные точки всех
  // сетей, симуляция (и, что хуже, /apply — реальная запись в schedules)
  // могла двигать сотрудника на точку вообще любой другой сети. Точки
  // чужой сети просто не попадают в coverage, поэтому move на них ниже
  // естественно отбрасывается как unknown_store — без отдельного чека.
  const stores = await query(
    `SELECT id, COALESCE(display_name, name) as name, code, COALESCE(color, '#2AABEE') as color
     FROM stores s WHERE COALESCE(is_active, true) = true AND COALESCE(org_id,'default') = $1 ORDER BY s.name`,
    [opts.orgId]
  );

  type Cov = {
    store_id: string;
    name: string;
    code: string;
    color: string;
    staff_ids: number[];
    expected: Record<string, number>;
    after: Record<string, number>;
  };

  const coverage: Record<string, Cov> = {};

  for (const st of stores.rows) {
    const staff = await query(
      `SELECT employee_id FROM schedules
       WHERE store_id = $1 AND work_date::date = $2::date AND COALESCE(hours, 0) > 0`,
      [st.id, date]
    );
    const ids = staff.rows.map((r: any) => Number(r.employee_id));
    const expected: Record<string, number> = { sim: 0, mnp: 0, pa: 0, combo: 0 };
    for (const eid of ids) {
      const ps = await perShiftPlan(eid, date);
      for (const m of METRICS) expected[m] += ps[m];
    }
    coverage[st.id] = {
      store_id: st.id,
      name: st.name,
      code: st.code,
      color: st.color,
      staff_ids: [...ids],
      expected: { ...expected },
      after: { ...expected }
    };
  }

  const baselineStaff: Record<string, number> = {};
  for (const id of Object.keys(coverage)) {
    baselineStaff[id] = coverage[id].staff_ids.length;
  }

  const applied: any[] = [];

  for (const mv of moves) {
    const emp = Number(mv.employee_id);
    if (!emp || !mv.to_store) continue;
    const to = String(mv.to_store);
    let from = mv.from_store ? String(mv.from_store) : null;

    if (!from) {
      for (const c of Object.values(coverage)) {
        if (c.staff_ids.includes(emp)) {
          from = c.store_id;
          break;
        }
      }
    }

    if (!from || from === to || !coverage[from] || !coverage[to]) {
      applied.push({
        employee_id: emp,
        from,
        to,
        skipped: true,
        reason: !from ? 'not_on_shift' : from === to ? 'same_store' : 'unknown_store'
      });
      continue;
    }

    const ps = await perShiftPlan(emp, date);

    coverage[from].staff_ids = coverage[from].staff_ids.filter((id) => id !== emp);
    for (const m of METRICS) {
      coverage[from].after[m] = Math.max(0, coverage[from].after[m] - ps[m]);
    }

    if (!coverage[to].staff_ids.includes(emp)) {
      coverage[to].staff_ids.push(emp);
      for (const m of METRICS) coverage[to].after[m] += ps[m];
    }

    applied.push({ employee_id: emp, from, to, per_shift: ps, skipped: false });
  }

  const result = Object.values(coverage).map((c) => ({
    store_id: c.store_id,
    name: c.name,
    code: c.code,
    color: c.color,
    staff_before: baselineStaff[c.store_id] || 0,
    staff_after: c.staff_ids.length,
    expected: c.expected,
    after: c.after,
    delta_sim: c.after.sim - c.expected.sim,
    delta_mnp: c.after.mnp - c.expected.mnp,
    delta_pa: c.after.pa - c.expected.pa
  }));

  return {
    date,
    moves_applied: applied,
    stores: result,
    summary: {
      stores_gained: result.filter((s) => s.delta_sim > 0).map((s) => s.name),
      stores_lost: result.filter((s) => s.delta_sim < 0).map((s) => s.name)
    }
  };
}
