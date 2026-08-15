/**
 * Живая карта сети, умные алерты, what-if симуляция переноса смен.
 * Выделено из routes-v13.ts.
 */
import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import { requireAuth, requireManager, resolveViewOrgId, assertStoreInOrg } from './middleware-auth.js';
import { getLiveNetworkMap } from './services/live-map.js';
import { runSmartAlertsTick } from './services/alerts.js';
import { simulateScheduleMoves } from './services/what-if.js';
import { todayMoscow, toDateISO } from './utils/date.js';

export async function registerLiveAlertsRoutes(app: FastifyInstance) {
  // ========== LIVE MAP + ALERTS ==========
  app.get('/network/live', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { org_id } = request.query as { org_id?: string };
    return getLiveNetworkMap(resolveViewOrgId(request.user!, org_id));
  });

  const VALID_ALERT_STATUSES = new Set(['open', 'acked', 'in_progress', 'resolved', 'dismissed']);

  // status по умолчанию 'open' — обратная совместимость с тем, как этот
  // роут работал до 18.6 (был жёстко захардкожен на открытые алерты).
  app.get('/alerts', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { org_id, status } = request.query as { org_id?: string; status?: string };
    const orgId = resolveViewOrgId(request.user!, org_id);
    const statusFilter = status && VALID_ALERT_STATUSES.has(status) ? status : 'open';
    const res = await query(
      `SELECT a.*, COALESCE(st.display_name, st.name) as store_name,
         t.id as task_id, t.status as task_status
       FROM smart_alerts a
       LEFT JOIN stores st ON st.id = a.store_id
       LEFT JOIN tasks t ON t.alert_id = a.id
       WHERE a.status = $1 AND COALESCE(st.org_id,'default') = $2
       ORDER BY a.created_at DESC LIMIT 50`,
      [statusFilter, orgId]
    );
    return res.rows;
  });

  app.post('/alerts/:id/ack', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const { org_id } = (request.body || {}) as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, org_id);
    const alert = await query(`SELECT store_id FROM smart_alerts WHERE id = $1`, [Number(id)]);
    if (!alert.rows[0]) return reply.code(404).send({ error: 'not found' });
    // Раньше можно было погасить чужой алерт, зная/угадав его id (обычный
    // инкрементный bigint) — manager другой сети мог тихо снять критический
    // алерт вообще любой сети.
    if (alert.rows[0].store_id && !(await assertStoreInOrg(alert.rows[0].store_id, orgId))) {
      return reply.code(403).send({ error: 'forbidden', message: 'Алерт не принадлежит вашей сети' });
    }
    const res = await query(
      `UPDATE smart_alerts SET status='acked', acked_at=now(), acked_by=$1, updated_at=now()
       WHERE id=$2 RETURNING *`,
      [request.user!.employee_id, Number(id)]
    );
    return res.rows[0];
  });

  // 18.6 — полный жизненный цикл алерта (не только open->acked). /ack
  // остаётся отдельным эндпоинтом для обратной совместимости, но теперь
  // это частный случай той же логики.
  app.post('/alerts/:id/status', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { org_id?: string; status?: string };
    const orgId = resolveViewOrgId(request.user!, body.org_id);
    const alert = await query(`SELECT store_id FROM smart_alerts WHERE id = $1`, [Number(id)]);
    if (!alert.rows[0]) return reply.code(404).send({ error: 'not found' });
    if (alert.rows[0].store_id && !(await assertStoreInOrg(alert.rows[0].store_id, orgId))) {
      return reply.code(403).send({ error: 'forbidden', message: 'Алерт не принадлежит вашей сети' });
    }
    const status = String(body.status || '');
    if (!VALID_ALERT_STATUSES.has(status) || status === 'open') {
      return reply.code(400).send({ error: 'invalid status' });
    }
    const res = await query(
      `UPDATE smart_alerts SET
         status = $1,
         updated_at = now(),
         acked_at = COALESCE(acked_at, now()),
         acked_by = COALESCE(acked_by, $2)
       WHERE id = $3 RETURNING *`,
      [status, request.user!.employee_id, Number(id)]
    );
    return res.rows[0];
  });

  app.post('/alerts/run', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    return runSmartAlertsTick();
  });

  // ========== WHAT-IF ==========
  app.post('/schedule/what-if', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const body = (request.body || {}) as any;
    const moves = Array.isArray(body.moves) ? body.moves : [];
    // одиночный шорткат
    if (!moves.length && body.employee_id && body.to_store) {
      moves.push({
        employee_id: Number(body.employee_id),
        from_store: body.from_store || null,
        to_store: body.to_store,
        work_date: body.date
      });
    }
    const orgId = resolveViewOrgId(request.user!, body.org_id);
    try {
      return await simulateScheduleMoves({ date: body.date, moves, orgId });
    } catch (e: any) {
      return reply.code(500).send({ error: 'what_if_failed', message: e?.message || String(e) });
    }
  });

  /** Применить what-if сдвиги в schedules (реальная запись) */
  app.post('/schedule/what-if/apply', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const body = (request.body || {}) as any;
    const date = toDateISO(body.date || todayMoscow());
    const moves = Array.isArray(body.moves) ? body.moves : [];
    if (!moves.length && body.employee_id && body.to_store) {
      moves.push({
        employee_id: Number(body.employee_id),
        from_store: body.from_store || null,
        to_store: body.to_store
      });
    }
    if (!moves.length) {
      return reply.code(400).send({ error: 'moves required' });
    }

    // Точки не своей сети simulateScheduleMoves теперь просто не видит
    // (coverage строится только по своей сети) — moves на них уже придут
    // сюда как skipped: 'unknown_store', реальной записи в schedules не будет.
    const orgId = resolveViewOrgId(request.user!, body.org_id);
    const sim = await simulateScheduleMoves({ date, moves, orgId });
    const applied = [];
    for (const m of sim.moves_applied || []) {
      if (m.skipped) continue;
      const emp = Number(m.employee_id);
      const to = m.to_store || m.to;
      if (!emp || !to) continue;

      // сохранить shift_text/hours с текущей смены если есть
      const cur = await query(
        `SELECT shift_text, hours FROM schedules
         WHERE employee_id = $1 AND work_date::date = $2::date LIMIT 1`,
        [emp, date]
      );
      const shift_text = cur.rows[0]?.shift_text || '10-21';
      const hours = Number(cur.rows[0]?.hours) || 11;

      const res = await query(
        `INSERT INTO schedules (employee_id, store_id, work_date, shift_text, hours)
         VALUES ($1,$2,$3::date,$4,$5)
         ON CONFLICT (employee_id, work_date)
         DO UPDATE SET store_id = EXCLUDED.store_id,
                       shift_text = EXCLUDED.shift_text,
                       hours = EXCLUDED.hours
         RETURNING *`,
        [emp, to, date, shift_text, hours]
      );
      applied.push(res.rows[0]);
    }

    return {
      ok: true,
      date,
      count: applied.length,
      items: applied,
      simulation: sim
    };
  });
}
