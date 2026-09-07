import { query } from '../db/index.js';
export async function employeeInputs(org: string, start: string, end: string, asOf: string, columns: string[]) {
  const employees = (await query(`SELECT id,full_name,short_name,role FROM employees e
    WHERE COALESCE(org_id,'default')=$1 AND (is_active OR
      EXISTS(SELECT 1 FROM sales s WHERE s.employee_id=e.id AND sale_date >= $2 AND sale_date < $3) OR
      EXISTS(SELECT 1 FROM employee_month_plans p WHERE p.employee_id=e.id AND month=$2)) ORDER BY full_name`,[org,start,end])).rows;
  const ids=employees.map(e=>e.id);
  const [p,f,c,m]=await Promise.all([
    query('SELECT * FROM employee_month_plans WHERE employee_id=ANY($1) AND month=$2',[ids,start]),
    query(`SELECT employee_id,${columns.map(c=>`COALESCE(SUM(${c}),0) AS ${c}`).join(',')} FROM sales
      WHERE employee_id=ANY($1) AND sale_date >= $2 AND sale_date < $3 GROUP BY employee_id`,[ids,start,end]),
    query(`SELECT employee_id,COUNT(*)::int total,
      COUNT(*) FILTER(WHERE work_date >= $4)::int remaining,
      COUNT(*) FILTER(WHERE work_date <= $4)::int worked
      FROM schedules WHERE employee_id=ANY($1) AND work_date >= $2 AND work_date < $3 AND hours>0 GROUP BY employee_id`,[ids,start,end,asOf]),
    query('SELECT * FROM bfq_manual WHERE employee_id=ANY($1) AND month=$2',[ids,start])
  ]);
  const map=(rows:any[])=>new Map<string,any>(rows.map(r=>[String(r.employee_id),r]));
  return {employees,plans:map(p.rows),facts:map(f.rows),counts:map(c.rows),manual:map(m.rows)};
}
export async function storeInputs(org: string, start: string, end: string, columns: string[], onlyIds?: string[]) {
  const stores=(await query(`SELECT id,COALESCE(display_name,name) name,code FROM stores
    WHERE COALESCE(org_id,'default')=$1 AND ($2::text[] IS NULL OR id=ANY($2))`,[org,onlyIds ?? null])).rows;
  const ids=stores.map(s=>s.id);
  const [p,f]=await Promise.all([
    query('SELECT * FROM store_month_plans WHERE store_id=ANY($1) AND month=$2',[ids,start]),
    query(`SELECT store_id,${columns.map(c=>`COALESCE(SUM(${c}),0) AS ${c}`).join(',')} FROM sales
      WHERE store_id=ANY($1) AND sale_date >= $2 AND sale_date < $3 GROUP BY store_id`,[ids,start,end])
  ]);
  const map=(rows:any[])=>new Map<string,any>(rows.map(r=>[String(r.store_id),r]));
  return {stores,plans:map(p.rows),facts:map(f.rows)};
}
export async function daySnapshot(employeeId: number,date: string) {
  return (await query(`SELECT day_plan_snapshot FROM shift_sessions WHERE employee_id=$1 AND work_date=$2
    AND day_plan_snapshot IS NOT NULL ORDER BY id DESC LIMIT 1`,[employeeId,date])).rows[0]?.day_plan_snapshot;
}
export async function saveDaySnapshot(id: string,plan: Record<string,number>) {
  return (await query('UPDATE shift_sessions SET day_plan_snapshot=COALESCE(day_plan_snapshot,$2::jsonb) WHERE id=$1 RETURNING day_plan_snapshot',[id,JSON.stringify(plan)])).rows[0].day_plan_snapshot;
}
