/**
 * График смен: день, правка, месяц целиком.
 * Вынесено из index.ts при разбиении монолита на модули.
 */
import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import { todayMoscow, currentMonthMoscow } from './utils/date.js';
import { requireActive, requireManager } from './middleware-auth.js';

export async function registerSchedulesRoutes(app: FastifyInstance) {
  app.get('/schedules', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const { date } = request.query as { date?: string };
    const workDate = date || todayMoscow();

    const res = await query(
      `SELECT sch.*, e.full_name, st.name as store_name, st.short_name as store_short
       FROM schedules sch
       JOIN employees e ON e.id = sch.employee_id
       JOIN stores st ON st.id = sch.store_id
       WHERE sch.work_date::date = $1::date
       ORDER BY st.hours, e.full_name`,
      [workDate]
    );
    return res.rows;
  });

  app.post('/schedules', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const body = request.body as any;
    const { employee_id, store_id, work_date, shift_text, hours } = body;

    const res = await query(
      `INSERT INTO schedules (employee_id, store_id, work_date, shift_text, hours)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (employee_id, work_date)
       DO UPDATE SET
         store_id = EXCLUDED.store_id,
         shift_text = EXCLUDED.shift_text,
         hours = EXCLUDED.hours
       RETURNING *`,
      [employee_id, store_id, work_date, shift_text, hours]
    );
    return res.rows[0];
  });

  app.get('/schedules/month', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const { month } = request.query as { month?: string };
    const m = month || currentMonthMoscow();
    const start = `${m}-01`;
    const endDate = new Date(`${m}-01T00:00:00Z`);
    endDate.setUTCMonth(endDate.getUTCMonth() + 1);
    const end = endDate.toISOString().slice(0, 10);

    const res = await query(
      `SELECT sch.work_date, sch.shift_text, sch.hours, sch.store_id,
              e.id as employee_id, e.full_name, e.short_name,
              st.name as store_name, st.short_name as store_short
       FROM schedules sch
       JOIN employees e ON e.id = sch.employee_id
       LEFT JOIN stores st ON st.id = sch.store_id
       WHERE sch.work_date >= $1 AND sch.work_date < $2
       ORDER BY e.full_name, sch.work_date`,
      [start, end]
    );

    return { month: m, start, end, items: res.rows };
  });
}
