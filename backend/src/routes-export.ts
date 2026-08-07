/**
 * История продаж, аудит правок, CSV-экспорты (продажи/BFQ/график).
 * Выделено из routes-v3.ts.
 */
import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import { calculateAllBFQ } from './services/bfq.js';
import { requireAuth, requireManager, isManager } from './middleware-auth.js';
import { todayMoscow, currentMonthMoscow } from './utils/date.js';

function csvEscape(v: any) {
  const s = String(v ?? '');
  if (/[;"\n,]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function registerExportRoutes(app: FastifyInstance) {
  // ========== HISTORY ==========
  app.get('/sales/history', async (request, reply) => {
    if (!requireAuth(request, reply)) return;

    const q = request.query as {
      from?: string;
      to?: string;
      employee_id?: string;
      store_id?: string;
      limit?: string;
    };

    const from = q.from || todayMoscow().slice(0, 8) + '01';
    const to = q.to || todayMoscow();
    const limit = Math.min(Number(q.limit) || 500, 2000);

    // employee видит только себя, manager — всех
    let employeeFilter = q.employee_id ? Number(q.employee_id) : null;
    if (!isManager(request.user) && request.user) {
      employeeFilter = request.user.employee_id;
    }

    const params: any[] = [from, to];
    let sql = `
      SELECT s.*, e.full_name, st.name as store_name
      FROM sales s
      JOIN employees e ON e.id = s.employee_id
      JOIN stores st ON st.id = s.store_id
      WHERE s.sale_date >= $1 AND s.sale_date <= $2
    `;
    if (employeeFilter) {
      params.push(employeeFilter);
      sql += ` AND s.employee_id = $${params.length}`;
    }
    if (q.store_id) {
      params.push(q.store_id);
      sql += ` AND s.store_id = $${params.length}`;
    }
    params.push(limit);
    sql += ` ORDER BY s.sale_date DESC, e.full_name LIMIT $${params.length}`;

    const res = await query(sql, params);
    return { from, to, count: res.rows.length, items: res.rows };
  });

  app.get('/sales/audit', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const q = request.query as { from?: string; to?: string; employee_id?: string };
    const from = q.from || todayMoscow().slice(0, 8) + '01';
    const to = q.to || todayMoscow();
    const params: any[] = [from, to];
    let sql = `
      SELECT a.*, e.full_name, st.name as store_name
      FROM sales_audit a
      LEFT JOIN employees e ON e.id = a.employee_id
      LEFT JOIN stores st ON st.id = a.store_id
      WHERE a.sale_date >= $1 AND a.sale_date <= $2
    `;
    if (q.employee_id) {
      params.push(Number(q.employee_id));
      sql += ` AND a.employee_id = $${params.length}`;
    }
    sql += ` ORDER BY a.created_at DESC LIMIT 500`;
    const res = await query(sql, params);
    return res.rows;
  });

  // ========== EXPORT ==========
  app.get('/export/sales.csv', async (request, reply) => {
    if (!requireManager(request, reply)) return;

    const q = request.query as { from?: string; to?: string; store_id?: string };
    const from = q.from || todayMoscow().slice(0, 8) + '01';
    const to = q.to || todayMoscow();
    const params: any[] = [from, to];
    let sql = `
      SELECT s.sale_date, e.full_name, st.name as store_name, st.code,
             s.sim, s.mnp, s.pa, s.combo, s.phones, s.accessories,
             s.insurance, s.wink, s.shpd, s.focus, s.settings,
             s.credit_request, s.credit_issued, s.plotter, s.hb
      FROM sales s
      JOIN employees e ON e.id = s.employee_id
      JOIN stores st ON st.id = s.store_id
      WHERE s.sale_date >= $1 AND s.sale_date <= $2
    `;
    if (q.store_id) {
      params.push(q.store_id);
      sql += ` AND s.store_id = $${params.length}`;
    }
    sql += ` ORDER BY s.sale_date, e.full_name`;

    const res = await query(sql, params);
    const header = [
      'date', 'employee', 'store', 'code',
      'sim', 'mnp', 'pa', 'combo', 'phones', 'accessories',
      'insurance', 'wink', 'shpd', 'focus', 'settings',
      'credit_request', 'credit_issued', 'plotter', 'hb'
    ];

    const lines = [header.join(';')];
    for (const r of res.rows) {
      lines.push([
        String(r.sale_date).slice(0, 10),
        r.full_name, r.store_name, r.code,
        r.sim, r.mnp, r.pa, r.combo, r.phones, r.accessories,
        r.insurance, r.wink, r.shpd, r.focus, r.settings,
        r.credit_request, r.credit_issued, r.plotter, r.hb
      ].map(csvEscape).join(';'));
    }

    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="sales_${from}_${to}.csv"`)
      .send('﻿' + lines.join('\n'));
  });

  app.get('/export/bfq.csv', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { month } = request.query as { month?: string };
    const m = month || currentMonthMoscow();
    const items = await calculateAllBFQ(m);

    const header = [
      'employee', 'bfq_fact', 'bfq_forecast', 'quality', 'profit',
      'vmr', 'penalty', 'sim_pct', 'mnp_pct', 'pa_pct', 'combo_pct',
      'phones_pct', 'worked_shifts', 'remaining_shifts'
    ];
    const lines = [header.join(';')];
    for (const r of items) {
      lines.push([
        r.full_name,
        r.total,
        r.forecast,
        r.quality,
        r.profit,
        r.vmr,
        r.penalty,
        r.pct?.sim,
        r.pct?.mnp,
        r.pct?.pa,
        r.pct?.combo,
        r.pct?.phones,
        r.shifts?.worked,
        r.shifts?.remaining
      ].map(csvEscape).join(';'));
    }

    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="bfq_${m}.csv"`)
      .send('﻿' + lines.join('\n'));
  });

  app.get('/export/schedules.csv', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { month } = request.query as { month?: string };
    const m = month || currentMonthMoscow();
    const start = `${m}-01`;
    const endDate = new Date(`${m}-01T12:00:00`);
    endDate.setMonth(endDate.getMonth() + 1);
    const end = endDate.toISOString().slice(0, 10);

    const res = await query(
      `SELECT sch.work_date, e.full_name, st.name as store_name, st.code,
              sch.shift_text, sch.hours
       FROM schedules sch
       JOIN employees e ON e.id = sch.employee_id
       JOIN stores st ON st.id = sch.store_id
       WHERE sch.work_date >= $1 AND sch.work_date < $2
       ORDER BY sch.work_date, e.full_name`,
      [start, end]
    );

    const header = ['date', 'employee', 'store', 'code', 'shift', 'hours'];
    const lines = [header.join(';')];
    for (const r of res.rows) {
      lines.push([
        String(r.work_date).slice(0, 10),
        r.full_name, r.store_name, r.code, r.shift_text, r.hours
      ].map(csvEscape).join(';'));
    }

    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="schedules_${m}.csv"`)
      .send('﻿' + lines.join('\n'));
  });
}
