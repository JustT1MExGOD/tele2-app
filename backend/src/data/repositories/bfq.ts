/**
 * Data Access Layer (20.8.0, Full DAL) — VMR-анкеты (bfq_questionnaires).
 */
import { query } from '../db/index.js';

export async function findShiftsInRange(employeeId: number, start: string, end: string): Promise<{ work_date: string; hours: number }[]> {
  const res = await query(
    `SELECT work_date, hours
     FROM schedules
     WHERE employee_id = $1
       AND work_date >= $2
       AND work_date < $3
       AND hours > 0
     ORDER BY work_date`,
    [employeeId, start, end]
  );
  return res.rows;
}

export async function sumMonthFacts(employeeId: number, start: string, end: string): Promise<Record<string, number>> {
  const res = await query(
    `SELECT
       COALESCE(SUM(sim),0) as sim,
       COALESCE(SUM(mnp),0) as mnp,
       COALESCE(SUM(pa),0) as pa,
       COALESCE(SUM(combo),0) as combo,
       COALESCE(SUM(phones),0) as phones,
       COALESCE(SUM(accessories),0) as accessories,
       COALESCE(SUM(focus),0) as focus,
       COALESCE(SUM(settings),0) as settings,
       COALESCE(SUM(wink),0) as wink,
       COALESCE(SUM(shpd),0) as shpd,
       COALESCE(SUM(insurance),0) as insurance,
       COALESCE(SUM(credit_issued),0) as credit,
       COALESCE(SUM(plotter),0) as plotter
     FROM sales
     WHERE employee_id = $1 AND sale_date >= $2 AND sale_date < $3`,
    [employeeId, start, end]
  );
  return res.rows[0] || {};
}

export async function findManual(employeeId: number, monthStart: string): Promise<{ vmr_avg: number | null; penalty: number | null } | null> {
  const res = await query(
    `SELECT vmr_avg, penalty FROM bfq_manual
     WHERE employee_id = $1 AND month = $2`,
    [employeeId, monthStart]
  );
  return res.rows[0] || null;
}

export async function listActiveEmployeesForOrg(orgId: string): Promise<{ id: number; full_name: string; short_name: string | null; role: string }[]> {
  const res = await query(
    `SELECT id, full_name, short_name, role
     FROM employees
     WHERE is_active = true AND COALESCE(org_id, 'default') = $1
     ORDER BY full_name`,
    [orgId]
  );
  return res.rows;
}

export async function upsertManual(employeeId: number, monthStart: string, vmrAvg: number, penalty: number): Promise<any> {
  const res = await query(
    `INSERT INTO bfq_manual (employee_id, month, vmr_avg, penalty)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (employee_id, month)
     DO UPDATE SET vmr_avg = EXCLUDED.vmr_avg, penalty = EXCLUDED.penalty
     RETURNING *`,
    [employeeId, monthStart, vmrAvg, penalty]
  );
  return res.rows[0];
}

export async function insertQuestionnaire(employeeId: number, score: number, comment: string): Promise<any> {
  const res = await query(
    `INSERT INTO bfq_questionnaires (employee_id, score, comment)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [employeeId, score, comment]
  );
  return res.rows[0];
}

export async function avgQuestionnaireScore(employeeId: number, monthStart: string): Promise<number | null> {
  const res = await query(
    `SELECT AVG(score) as avg FROM bfq_questionnaires
     WHERE employee_id = $1 AND created_at >= $2::date`,
    [employeeId, monthStart]
  );
  return res.rows[0]?.avg ?? null;
}

export async function findManualPenalty(employeeId: number, monthStart: string): Promise<number | null> {
  const res = await query(
    `SELECT penalty FROM bfq_manual WHERE employee_id = $1 AND month = $2`,
    [employeeId, monthStart]
  );
  return res.rows[0]?.penalty ?? null;
}

export async function listQuestionnaires(monthStart: string, orgId: string, employeeId?: number | null): Promise<any[]> {
  const params: any[] = [monthStart, orgId];
  let sql = `
    SELECT q.*, e.full_name
    FROM bfq_questionnaires q
    JOIN employees e ON e.id = q.employee_id
    WHERE q.created_at >= $1::date AND COALESCE(e.org_id,'default') = $2
  `;
  if (employeeId) {
    params.push(employeeId);
    sql += ` AND q.employee_id = $${params.length}`;
  }
  sql += ` ORDER BY q.created_at DESC LIMIT 200`;
  const res = await query(sql, params);
  return res.rows;
}
