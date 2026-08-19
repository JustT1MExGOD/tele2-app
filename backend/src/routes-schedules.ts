/**
 * График смен: день, правка (в т.ч. массовая), месяц целиком.
 * Вынесено из index.ts при разбиении монолита на модули; /schedules/bulk и
 * DELETE /schedules переехали сюда же из routes-v3.ts — раньше мутации
 * графика были раскиданы по двум файлам.
 */
import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import { todayMoscow, currentMonthMoscow } from './utils/date.js';
import { requireActive, requireManager, resolveViewOrgId, assertStoreInOrg, assertEmployeeInOrg } from './middleware-auth.js';

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
      `SELECT sch.*, e.full_name, COALESCE(st.display_name, st.name) as store_name, st.short_name as store_short
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
    if (!(await assertStoreInOrg(store_id, orgId))) {
      return reply.code(403).send({ error: 'forbidden', message: 'Точка не принадлежит вашей сети' });
    }
    // Раньше проверялась только точка, не сотрудник — manager чужой сети
    // мог назначить НА СВОЮ точку сотрудника чужой сети (угадав его id), и
    // ON CONFLICT (employee_id, work_date) DO UPDATE молча перезаписывал
    // уже существующую смену жертвы на её собственной точке.
    if (!(await assertEmployeeInOrg(Number(employee_id), orgId))) {
      return reply.code(403).send({ error: 'forbidden', message: 'Сотрудник не принадлежит вашей сети' });
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
              COALESCE(st.display_name, st.name) as store_name, st.short_name as store_short
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

  /**
   * Массовое сохранение смен на месяц: { items: [{ employee_id, work_date,
   * store_id, shift_text, hours }] }. Каждая точка проверяется на
   * принадлежность своей сети — раньше (в routes-v3.ts) эта проверка тут
   * отсутствовала вообще, хотя одиночный POST /schedules её уже делал.
   */
  app.post('/schedules/bulk', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const body = request.body as any;
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) return reply.code(400).send({ error: 'items required' });

    const orgId = resolveViewOrgId(request.user!, body.org_id);
    const saved = [];
    for (const item of items) {
      const employee_id = Number(item.employee_id);
      const store_id = item.store_id;
      const work_date = String(item.work_date).slice(0, 10);
      const shift_text = item.shift_text || '';
      const hours = Number(item.hours) || 0;

      if (!employee_id || !store_id || !work_date) continue;
      if (!(await assertStoreInOrg(store_id, orgId))) continue;
      // Тот же пробел, что в одиночном POST /schedules — точка проверялась,
      // сотрудник нет.
      if (!(await assertEmployeeInOrg(employee_id, orgId))) continue;

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
    const { employee_id, work_date, org_id } = request.query as {
      employee_id?: string;
      work_date?: string;
      org_id?: string;
    };
    if (!employee_id || !work_date) {
      return reply.code(400).send({ error: 'employee_id and work_date required' });
    }
    // Раньше без проверки — manager любой сети мог удалить смену вообще
    // любого сотрудника на любую дату (та же дыра, что была в POST /schedules
    // до его собственного фикса — только тут вообще без чека).
    const existing = await query(
      `SELECT store_id FROM schedules WHERE employee_id = $1 AND work_date = $2`,
      [Number(employee_id), work_date]
    );
    if (existing.rows[0]?.store_id) {
      const orgId = resolveViewOrgId(request.user!, org_id);
      if (!(await assertStoreInOrg(existing.rows[0].store_id, orgId))) {
        return reply.code(403).send({ error: 'forbidden', message: 'Точка не принадлежит вашей сети' });
      }
    }
    await query(
      `DELETE FROM schedules WHERE employee_id = $1 AND work_date = $2`,
      [Number(employee_id), work_date]
    );
    return { ok: true };
  });
}
