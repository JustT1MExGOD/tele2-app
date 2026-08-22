/**
 * Data Access Layer (20.8.0, Full DAL) — SQL по таблицам `employee_month_plans`,
 * `store_month_plans`, `store_plans`. METRICS живёт здесь (а не в
 * services/plans.ts) — это буквально список колонок этих трёх таблиц, а не
 * бизнес-правило; services/plans.ts импортирует его отсюда.
 *
 * materializeRow() — 19.24.0: раньше начиналась с DELETE FROM store_plans
 * WHERE plan_date=$1, затем голые INSERT в цикле. Конкурентный вызов (правка
 * плана ровно в момент cron-прогона, или два сохранения планов разных точек
 * одновременно) мог либо оставить дубликаты строк (без UNIQUE-constraint'а),
 * либо дать читателям окно "плана нет" между DELETE и повторным INSERT.
 * Теперь per-store UPSERT (UNIQUE(store_id, plan_date), миграция 0013) —
 * атомарно на уровне строки. Перенесено дословно, включая fallback-ветку
 * без новых колонок (более старая схема) — не трогать её структуру.
 */
import { query } from '../db/index.js';

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

function num(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** GET /me/day — без fallback-повтора на LIKE (в отличие от findEmployeeMonthPlanRow ниже), тот же контракт, что был у роута до переезда. */
export async function findEmployeeMonthPlanExact(employeeId: number, monthDate: string): Promise<any | null> {
  const res = await query(
    `SELECT * FROM employee_month_plans
     WHERE employee_id = $1 AND month::date = $2::date`,
    [employeeId, monthDate]
  );
  return res.rows[0] || null;
}

/** GET /plans?date= — дневные планы точек своей сети на конкретную дату. */
export async function findDayPlansForOrg(date: string, orgId: string): Promise<any[]> {
  const res = await query(
    `SELECT sp.store_id, sp.plan_date,
            sp.sim, sp.mnp, sp.pa, sp.combo, sp.settings, sp.accessories, sp.insurance,
            sp.phones, sp.wink, sp.shpd, sp.focus, sp.credit_request, sp.credit_issued, sp.plotter, sp.hb
     FROM store_plans sp
     JOIN stores st ON st.id = sp.store_id
     WHERE sp.plan_date = $1 AND COALESCE(st.org_id, 'default') = $2
     ORDER BY sp.store_id`,
    [date, orgId]
  );
  return res.rows;
}

/** GET /plans (без date, или день без данных) — шаблоны планов точек своей сети. */
export async function findTemplatePlansForOrg(orgId: string): Promise<any[]> {
  const res = await query(
    `SELECT sp.store_id, sp.plan_date,
            sp.sim, sp.mnp, sp.pa, sp.combo, sp.settings, sp.accessories, sp.insurance,
            sp.phones, sp.wink, sp.shpd, sp.focus, sp.credit_request, sp.credit_issued
     FROM store_plans sp
     JOIN stores st ON st.id = sp.store_id
     WHERE sp.plan_date IS NULL AND COALESCE(st.org_id, 'default') = $1
     ORDER BY sp.store_id`,
    [orgId]
  );
  return res.rows;
}

export async function findEmployeeMonthPlanRow(employeeId: number, monthStartDate: string): Promise<any | null> {
  const res = await query(
    `SELECT * FROM employee_month_plans WHERE employee_id = $1 AND month = $2::date`,
    [employeeId, monthStartDate]
  ).catch(() =>
    query(
      `SELECT * FROM employee_month_plans WHERE employee_id = $1 AND month::text LIKE $2`,
      [employeeId, monthStartDate.slice(0, 7) + '%']
    )
  );
  return res.rows[0] || null;
}

/** cols/vals уже включают employee_id+month в начале — построены вызывающим кодом (services/plans.ts). */
export async function upsertEmployeeMonthPlanRow(
  employeeId: number, monthStartDate: string, cols: string[], vals: any[], updates: string, norm: Record<string, number>
): Promise<any> {
  const ph = cols.map((_, i) => `$${i + 1}`);
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
      [employeeId, monthStartDate]
    ).catch(() => ({ rows: [] as any[] }));

    if (existing.rows[0]) {
      const set = METRICS.map((m, i) => `${m} = $${i + 3}`).join(', ');
      const res = await query(
        `UPDATE employee_month_plans SET ${set}
         WHERE employee_id = $1 AND month = $2::date
         RETURNING *`,
        [employeeId, monthStartDate, ...METRICS.map((m) => norm[m])]
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

export async function findStoreMonthPlanRow(storeId: string, monthStartDate: string): Promise<any | null> {
  const res = await query(
    `SELECT * FROM store_month_plans WHERE store_id = $1 AND month = $2::date`,
    [storeId, monthStartDate]
  );
  return res.rows[0] || null;
}

export async function upsertStoreMonthPlanRow(storeId: string, monthStartDate: string, norm: Record<string, number>): Promise<any> {
  const cols = ['store_id', 'month', ...METRICS];
  const ph = cols.map((_, i) => `$${i + 1}`);
  const vals: any[] = [storeId, monthStartDate, ...METRICS.map((m) => norm[m])];
  const updates = METRICS.map((m) => `${m} = EXCLUDED.${m}`).join(', ');
  const res = await query(
    `INSERT INTO store_month_plans (${cols.join(', ')})
     VALUES (${ph.join(', ')})
     ON CONFLICT (store_id, month) DO UPDATE SET
       ${updates}, updated_at = now()
     RETURNING *`,
    vals
  );
  return res.rows[0];
}

export async function materializeRow(storeId: string, date: string, p: Record<string, number>): Promise<void> {
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
       )
       ON CONFLICT (store_id, plan_date) DO UPDATE SET
         sim = EXCLUDED.sim, mnp = EXCLUDED.mnp, pa = EXCLUDED.pa, combo = EXCLUDED.combo,
         phones = EXCLUDED.phones, accessories = EXCLUDED.accessories, focus = EXCLUDED.focus,
         settings = EXCLUDED.settings, wink = EXCLUDED.wink, shpd = EXCLUDED.shpd,
         insurance = EXCLUDED.insurance, credit_request = EXCLUDED.credit_request,
         credit_issued = EXCLUDED.credit_issued, plotter = EXCLUDED.plotter, hb = EXCLUDED.hb`,
      [
        storeId,
        date,
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
    // fallback без новых колонок (более старая схема)
    console.error('materialize insert', storeId, e?.message || e);
    await query(
      `INSERT INTO store_plans (
         store_id, plan_date,
         sim, mnp, pa, combo, phones, accessories, focus, settings,
         wink, shpd, insurance, credit_issued
       ) VALUES (
         $1,$2::date,
         $3,$4,$5,$6,$7,$8,$9,$10,
         $11,$12,$13,$14
       )
       ON CONFLICT (store_id, plan_date) DO UPDATE SET
         sim = EXCLUDED.sim, mnp = EXCLUDED.mnp, pa = EXCLUDED.pa, combo = EXCLUDED.combo,
         phones = EXCLUDED.phones, accessories = EXCLUDED.accessories, focus = EXCLUDED.focus,
         settings = EXCLUDED.settings, wink = EXCLUDED.wink, shpd = EXCLUDED.shpd,
         insurance = EXCLUDED.insurance, credit_issued = EXCLUDED.credit_issued`,
      [
        storeId,
        date,
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
