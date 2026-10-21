/**
 * Data Access Layer (20.8.0, Full DAL) — кастомные метрики плана/продаж
 * (plan_metrics) + динамические колонки в sales/store_plans/employee_month_plans.
 */
import { query } from '../db/index.js';

export async function listActiveDefs(): Promise<{ id: string; label: string; short_label: string | null; unit: string }[]> {
  const res = await query(
    `SELECT id, label, short_label, unit
     FROM plan_metrics
     WHERE COALESCE(is_active, true) = true
     ORDER BY sort_order NULLS LAST, id`
  );
  return res.rows;
}

/** getSalesSumColumns — реальные числовые колонки sales (не список из
 * plan_metrics, который может отставать от вручную добавленных миграцией
 * колонок). */
export async function listNumericSalesColumns(): Promise<string[]> {
  const res = await query(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_name = 'sales'
       AND data_type IN ('numeric', 'integer', 'bigint', 'double precision', 'real', 'smallint')
     ORDER BY ordinal_position`
  );
  return res.rows.map((r: any) => String(r.column_name));
}

/** table/col уже провалидированы вызывающим кодом (regex на id). q — см.
 * withTransaction в db/index.ts; по умолчанию пул, но роут (finding #6,
 * hotfix 20.57.1 PASS 2) обязан передавать клиент одной транзакции вместе
 * с upsert() ниже — ALTER TABLE в Postgres транзакционен, поэтому неудача
 * здесь откатывает и upsert(), а не оставляет активную метрику без колонки. */
export async function ensureColumn(table: string, col: string, q: typeof query = query): Promise<void> {
  await q(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} numeric DEFAULT 0`);
}

export async function nextSortOrder(): Promise<number> {
  const res = await query(`SELECT COALESCE(MAX(sort_order), 0) + 10 AS s FROM plan_metrics`);
  return Number(res.rows[0]?.s) || 200;
}

export async function upsert(id: string, label: string, short: string, unit: string, sort: number, q: typeof query = query): Promise<void> {
  try {
    await q(
      `INSERT INTO plan_metrics (id, label, short_label, unit, is_active, sort_order)
       VALUES ($1, $2, $3, $4, true, $5)
       ON CONFLICT (id) DO UPDATE SET
         label = EXCLUDED.label,
         short_label = EXCLUDED.short_label,
         unit = EXCLUDED.unit,
         is_active = true,
         sort_order = COALESCE(plan_metrics.sort_order, EXCLUDED.sort_order)`,
      [id, label, short, unit, sort]
    );
  } catch (e: any) {
    // create table if missing
    if (String(e?.message || e).includes('plan_metrics')) {
      await q(`
        CREATE TABLE IF NOT EXISTS plan_metrics (
          id text PRIMARY KEY,
          label text NOT NULL,
          short_label text,
          unit text DEFAULT 'count',
          is_active boolean DEFAULT true,
          sort_order int DEFAULT 100
        )`);
      await q(
        `INSERT INTO plan_metrics (id, label, short_label, unit, is_active, sort_order)
         VALUES ($1,$2,$3,$4,true,$5)
         ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, is_active = true`,
        [id, label, short, unit, sort]
      );
    } else {
      throw e;
    }
  }
}

export async function softDeactivate(id: string): Promise<void> {
  await query(`UPDATE plan_metrics SET is_active = false WHERE id = $1`, [id]);
}

export async function exists(id: string): Promise<boolean> {
  const res = await query(`SELECT 1 FROM plan_metrics WHERE id = $1`, [id]);
  return res.rows.length > 0;
}

/** Total row count — plan_metrics/its shadow columns on sales/store_plans/
 * employee_month_plans/store_month_plans are platform-wide (no org_id,
 * see hotfix note in api/routes/metrics.ts), so this caps the whole
 * platform's custom-column growth, not any one org's. */
export async function count(): Promise<number> {
  const res = await query(`SELECT COUNT(*)::int AS c FROM plan_metrics`);
  return Number(res.rows[0]?.c) || 0;
}

export interface LeaderboardRow {
  employee_id: number;
  full_name: string;
  value: number;
}

/** «Топы сотрудников» (план, 20.75.0) — сумма одной метрики по
 * сотрудникам за период, по образцу findTopEmployees в
 * supervisor-analytics.ts, но на ОДНУ метрику (не сводный score) и на
 * произвольный набор сетей (dealer/org-switcher-aware вызывающая
 * сторона, не захардкожено на storeIds сектора супервайзера).
 *
 * isSalesColumn — резолвится вызывающей стороной
 * (metrics-catalog.ts::getEmployeeLeaderboard через getSalesSumColumns())
 * ДО вызова этой функции: metricId интерполируется в SQL (имя колонки
 * нельзя параметризовать), поэтому вызывающая сторона обязана была уже
 * проверить, что metricId входит в реальный список колонок sales — та
 * же дисциплина, что ensureColumn() выше применяет к DDL. Эта функция
 * сама НИКОГДА не доверяет client-controlled metricId без этой
 * проверки apriori. */
export async function findEmployeeLeaderboard(
  orgIds: string[],
  metricId: string,
  from: string,
  to: string,
  isSalesColumn: boolean
): Promise<LeaderboardRow[]> {
  if (isSalesColumn) {
    const res = await query(
      `SELECT e.id AS employee_id, e.full_name, COALESCE(SUM(s."${metricId}"), 0) AS value
       FROM sales s
       JOIN employees e ON e.id = s.employee_id
       JOIN stores st ON st.id = s.store_id
       WHERE COALESCE(st.org_id, 'default') = ANY($1::text[])
         AND s.sale_date >= $2::date AND s.sale_date <= $3::date
       GROUP BY e.id, e.full_name
       HAVING COALESCE(SUM(s."${metricId}"), 0) > 0
       ORDER BY value DESC, e.full_name ASC`,
      [orgIds, from, to]
    );
    return res.rows.map((r: any) => ({ employee_id: Number(r.employee_id), full_name: r.full_name, value: Number(r.value) }));
  }
  const res = await query(
    `SELECT e.id AS employee_id, e.full_name, COALESCE(SUM(v.value), 0) AS value
     FROM sale_metric_values v
     JOIN employees e ON e.id = v.employee_id
     JOIN stores st ON st.id = v.store_id
     WHERE v.metric_id = $1
       AND COALESCE(st.org_id, 'default') = ANY($2::text[])
       AND v.sale_date >= $3::date AND v.sale_date <= $4::date
     GROUP BY e.id, e.full_name
     HAVING COALESCE(SUM(v.value), 0) > 0
     ORDER BY value DESC, e.full_name ASC`,
    [metricId, orgIds, from, to]
  );
  return res.rows.map((r: any) => ({ employee_id: Number(r.employee_id), full_name: r.full_name, value: Number(r.value) }));
}
