/**
 * График смен: день, правка, месяц целиком.
 * Вынесено из index.ts при разбиении монолита на модули.
 */
import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import { todayMoscow, currentMonthMoscow } from './utils/date.js';
import { requireActive, requireManager, resolveViewOrgId } from './middleware-auth.js';

export async function registerSchedulesRoutes(app: FastifyInstance) {
  // График — по точкам своей сети. Сотрудник может быть на смене в чужой
  // сети (подмена, см. README/эпик 17.0) — но каждая сеть видит смены на
  // СВОИХ точках, а не весь график сразу.
  app.get('/schedules', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const { date, org_id } = request.query as { date?: string; org_id?: string };
    const workDate = date || todayMoscow();
    const orgId = resolveViewOrgId(request.user!, org_id);

    // Своя запись видна всегда, даже если сегодня подменяешь в чужой сети —
    // иначе собственная смена пропадает из «Мой день»/формы продажи у
    // самого сотрудника, который её выполняет.
    const res = await query(
      `SELECT sch.*, e.full_name, st.name as store_name, st.short_name as store_short
       FROM schedules sch
       JOIN employees e ON e.id = sch.employee_id
       JOIN stores st ON st.id = sch.store_id
       WHERE sch.work_date::date = $1::date
         AND (COALESCE(st.org_id, 'default') = $2 OR sch.employee_id = $3)
       ORDER BY st.hours, e.full_name`,
      [workDate, orgId, request.user!.employee_id]
    );
    return res.rows;
  });

  app.post('/schedules', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const body = request.body as any;
    const { employee_id, store_id, work_date, shift_text, hours } = body;

    // Точка должна принадлежать своей сети (или сети, которую явно
    // выбрал admin переключателем) — иначе руководитель одной сети мог бы
    // расставлять смены на точках чужой сети.
    const orgId = resolveViewOrgId(request.user!, body.org_id);
    const storeCheck = await query(`SELECT COALESCE(org_id, 'default') as org_id FROM stores WHERE id = $1`, [store_id]);
    if (!storeCheck.rows[0] || storeCheck.rows[0].org_id !== orgId) {
      return reply.code(403).send({ error: 'forbidden', message: 'Точка не принадлежит вашей сети' });
    }

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
    const { month, org_id } = request.query as { month?: string; org_id?: string };
    const m = month || currentMonthMoscow();
    const start = `${m}-01`;
    const endDate = new Date(`${m}-01T00:00:00Z`);
    endDate.setUTCMonth(endDate.getUTCMonth() + 1);
    const end = endDate.toISOString().slice(0, 10);
    const orgId = resolveViewOrgId(request.user!, org_id);

    // Своя запись видна всегда — «Мой план» тоже читает этот эндпоинт, и
    // смена в чужой сети (подмена) не должна пропадать из личного графика.
    const res = await query(
      `SELECT sch.work_date, sch.shift_text, sch.hours, sch.store_id,
              e.id as employee_id, e.full_name, e.short_name,
              st.name as store_name, st.short_name as store_short
       FROM schedules sch
       JOIN employees e ON e.id = sch.employee_id
       LEFT JOIN stores st ON st.id = sch.store_id
       WHERE sch.work_date >= $1 AND sch.work_date < $2
         AND (COALESCE(st.org_id, 'default') = $3 OR sch.employee_id = $4)
       ORDER BY e.full_name, sch.work_date`,
      [start, end, orgId, request.user!.employee_id]
    );

    return { month: m, start, end, items: res.rows };
  });
}
