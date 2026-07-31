/**
 * Новые роуты v3:
 * - BFQ полный
 * - Редактор графика (bulk)
 * - Роли /me
 * - История и экспорт
 *
 * Подключение в index.ts:
 *   import { registerV3Routes } from './routes-v3.js';
 *   await registerV3Routes(app);
 */

import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import {
  calculateAllBFQ,
  calculateEmployeeBFQ,
  upsertBFQManual,
  addVMRQuestionnaire
} from './services/bfq.js';
import { authPlugin, requireAuth, requireManager, isManager } from './middleware-auth.js';
import { todayMoscow, currentMonthMoscow } from './utils/date.js';

function csvEscape(v: any) {
  const s = String(v ?? '');
  if (/[;"\n,]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function registerV3Routes(app: FastifyInstance) {
  // user на каждый запрос
  app.addHook('preHandler', authPlugin);

  // ========== ME / ROLE ==========
  app.get('/me', async (request, reply) => {
    if (!request.user) return reply.code(404).send({ error: 'not bound' });
    return {
      employee_id: request.user.employee_id,
      full_name: request.user.full_name,
      role: request.user.role,
      telegram_id: request.user.telegram_id,
      is_manager: isManager(request.user)
    };
  });

  app.post('/me/bind', async (request, reply) => {
    const body = request.body as any;
    const telegram_id = String(body?.telegram_id || '');
    const employee_id = Number(body?.employee_id);
    if (!telegram_id || !employee_id) {
      return reply.code(400).send({ error: 'telegram_id and employee_id required' });
    }

    await query(`UPDATE employees SET telegram_id = NULL WHERE telegram_id = $1`, [telegram_id]);
    await query(`UPDATE employees SET telegram_id = $1 WHERE id = $2`, [telegram_id, employee_id]);

    const res = await query(
      `SELECT id as employee_id, full_name, short_name, role, telegram_id
       FROM employees WHERE id = $1`,
      [employee_id]
    );
    return res.rows[0];
  });

  // Назначить роль (только manager/admin)
  app.post('/employees/:id/role', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const { role } = request.body as { role?: string };
    if (!['employee', 'manager', 'admin'].includes(String(role))) {
      return reply.code(400).send({ error: 'invalid role' });
    }
    const res = await query(
      `UPDATE employees SET role = $1 WHERE id = $2 RETURNING id, full_name, role`,
      [role, id]
    );
    return res.rows[0];
  });

  // ========== BFQ ==========
  app.get('/bfq', async (request) => {
    const { month } = request.query as { month?: string };
    const m = month || currentMonthMoscow();
    const items = await calculateAllBFQ(m);
    return { month: m, items };
  });

  app.get('/bfq/:employeeId', async (request) => {
    const { employeeId } = request.params as { employeeId: string };
    const { month } = request.query as { month?: string };
    const m = month || currentMonthMoscow();
    return calculateEmployeeBFQ(Number(employeeId), m);
  });

  // VMR + штраф (manager)
  app.post('/bfq/manual', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const body = request.body as any;
    const employee_id = Number(body.employee_id);
    const month = String(body.month || currentMonthMoscow());
    const vmr_avg = Number(body.vmr_avg) || 0;
    const penalty = Number(body.penalty) || 0;
    if (!employee_id) return reply.code(400).send({ error: 'employee_id required' });
    return upsertBFQManual(employee_id, month, vmr_avg, penalty);
  });

  // Анкета VMR
  app.post('/bfq/questionnaire', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const body = request.body as any;
    const employee_id = Number(body.employee_id);
    const score = Number(body.score);
    const comment = String(body.comment || '');
    if (!employee_id || !score) {
      return reply.code(400).send({ error: 'employee_id and score required' });
    }
    return addVMRQuestionnaire(employee_id, score, comment);
  });

  app.get('/bfq/questionnaires', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { employee_id, month } = request.query as { employee_id?: string; month?: string };
    const m = month || currentMonthMoscow();
    const start = `${m}-01`;
    const params: any[] = [start];
    let sql = `
      SELECT q.*, e.full_name
      FROM bfq_questionnaires q
      JOIN employees e ON e.id = q.employee_id
      WHERE q.created_at >= $1::date
    `;
    if (employee_id) {
      params.push(Number(employee_id));
      sql += ` AND q.employee_id = $2`;
    }
    sql += ` ORDER BY q.created_at DESC LIMIT 200`;
    const res = await query(sql, params);
    return res.rows;
  });

  // ========== SCHEDULE EDITOR ==========

  /** Массовое сохранение смен на месяц
   * body: {
   *   items: [{ employee_id, work_date, store_id, shift_text, hours }]
   * }
   * manager only
   */
  app.post('/schedules/bulk', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const body = request.body as any;
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) return reply.code(400).send({ error: 'items required' });

    const saved = [];
    for (const item of items) {
      const employee_id = Number(item.employee_id);
      const store_id = item.store_id;
      const work_date = String(item.work_date).slice(0, 10);
      const shift_text = item.shift_text || '';
      const hours = Number(item.hours) || 0;

      if (!employee_id || !store_id || !work_date) continue;

      if (hours <= 0) {
        // удалить смену
        await query(
          `DELETE FROM schedules WHERE employee_id = $1 AND work_date = $2`,
          [employee_id, work_date]
        );
        saved.push({ employee_id, work_date, deleted: true });
        continue;
      }

      const res = await query(
        `INSERT INTO schedules (employee_id, store_id, work_date, shift_text, hours)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (employee_id, work_date)
         DO UPDATE SET
           store_id = EXCLUDED.store_id,
           shift_text = EXCLUDED.shift_text,
           hours = EXCLUDED.hours
         RETURNING *`,
        [employee_id, store_id, work_date, shift_text, hours]
      );
      saved.push(res.rows[0]);
    }

    return { ok: true, count: saved.length, items: saved };
  });

  /** Удалить одну смену */
  app.delete('/schedules', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { employee_id, work_date } = request.query as {
      employee_id?: string;
      work_date?: string;
    };
    if (!employee_id || !work_date) {
      return reply.code(400).send({ error: 'employee_id and work_date required' });
    }
    await query(
      `DELETE FROM schedules WHERE employee_id = $1 AND work_date = $2`,
      [Number(employee_id), work_date]
    );
    return { ok: true };
  });

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
      .send('\uFEFF' + lines.join('\n'));
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
      .send('\uFEFF' + lines.join('\n'));
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
      .send('\uFEFF' + lines.join('\n'));
  });
}
