/**
 * Живая карта сети, умные алерты, what-if симуляция переноса смен.
 * Выделено из routes-v13.ts.
 */
import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import { requireAuth, requireManager, resolveViewOrgId } from './middleware-auth.js';
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

  app.get('/alerts', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { org_id } = request.query as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, org_id);
    const res = await query(
      `SELECT a.*, st.name as store_name
       FROM smart_alerts a
       LEFT JOIN stores st ON st.id = a.store_id
       WHERE a.status = 'open' AND COALESCE(st.org_id,'default') = $1
       ORDER BY a.created_at DESC LIMIT 50`,
      [orgId]
    );
    return res.rows;
  });

  app.post('/alerts/:id/ack', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const res = await query(
      `UPDATE smart_alerts SET status='acked', acked_at=now(), acked_by=$1
       WHERE id=$2 RETURNING *`,
      [request.user!.employee_id, Number(id)]
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
    try {
      return await simulateScheduleMoves({ date: body.date, moves });
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

    // сначала симуляция — отсечь skipped
    const sim = await simulateScheduleMoves({ date, moves });
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
