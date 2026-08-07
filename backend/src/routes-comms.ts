/**
 * Объявления сети и каналы-обсуждения. Выделено из routes-v13.ts.
 */
import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import { requireAuth, requireManager } from './middleware-auth.js';

export async function registerCommsRoutes(app: FastifyInstance) {
  app.get('/announcements', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const empId = request.user!.employee_id!;
    const res = await query(
      `SELECT a.*,
              EXISTS(
                SELECT 1 FROM announcement_reads r
                WHERE r.announcement_id = a.id AND r.employee_id = $1
              ) as is_read
       FROM announcements a
       WHERE a.active = true
       ORDER BY a.created_at DESC
       LIMIT 50`,
      [empId]
    );
    return res.rows;
  });

  app.post('/announcements', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const body = (request.body || {}) as any;
    const res = await query(
      `INSERT INTO announcements (title, body, required, created_by)
       VALUES ($1,$2,COALESCE($3,true),$4) RETURNING *`,
      [body.title, body.body, body.required, request.user!.employee_id]
    );
    return res.rows[0];
  });

  app.post('/announcements/:id/read', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    await query(
      `INSERT INTO announcement_reads (announcement_id, employee_id)
       VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [Number(id), request.user!.employee_id]
    );
    return { ok: true };
  });

  // Кто прочитал объявление — раньше read-статус был виден только самому
  // сотруднику (is_read у себя), manager не мог понять, кто из команды ещё
  // не в курсе обязательного объявления.
  app.get('/announcements/:id/reads', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const read = await query(
      `SELECT e.id, e.full_name, r.read_at
       FROM announcement_reads r
       JOIN employees e ON e.id = r.employee_id
       WHERE r.announcement_id = $1
       ORDER BY r.read_at`,
      [id]
    );
    const unread = await query(
      `SELECT e.id, e.full_name
       FROM employees e
       WHERE COALESCE(e.is_active, true) = true AND e.access_status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM announcement_reads r
           WHERE r.announcement_id = $1 AND r.employee_id = e.id
         )
       ORDER BY e.full_name`,
      [id]
    );
    return { read: read.rows, unread: unread.rows };
  });

  app.get('/channels/:id/messages', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const res = await query(
      `SELECT m.*, e.full_name as author_name
       FROM channel_messages m
       LEFT JOIN employees e ON e.id = m.author_id
       WHERE m.channel_id = $1
       ORDER BY m.created_at DESC LIMIT 100`,
      [id]
    );
    return res.rows.reverse();
  });

  app.post('/channels/:id/messages', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as any;
    const text = String(body.body || body.message || '').trim();
    if (!text) return reply.code(400).send({ error: 'body required' });
    const res = await query(
      `INSERT INTO channel_messages (channel_id, author_id, body, due_at)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [id, request.user!.employee_id, text, body.due_at || null]
    );
    return res.rows[0];
  });
}
