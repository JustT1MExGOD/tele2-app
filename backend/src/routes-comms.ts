/**
 * Объявления сети и каналы-обсуждения. Выделено из routes-v13.ts.
 * announcements.org_id и channels.org_id существовали в схеме и раньше,
 * но ни один запрос их не читал — тот же паттерн, что plan_share и
 * micro_report_times до этого: сотрудник любой сети видел объявления
 * и мог читать/писать в каналы вообще всех сетей.
 */
import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import { requireAuth, requireManager, resolveViewOrgId } from './middleware-auth.js';

export async function registerCommsRoutes(app: FastifyInstance) {
  app.get('/announcements', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const empId = request.user!.employee_id!;
    const { org_id } = request.query as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, org_id);
    const res = await query(
      `SELECT a.*,
              EXISTS(
                SELECT 1 FROM announcement_reads r
                WHERE r.announcement_id = a.id AND r.employee_id = $1
              ) as is_read
       FROM announcements a
       WHERE a.active = true AND COALESCE(a.org_id,'default') = $2
       ORDER BY a.created_at DESC
       LIMIT 50`,
      [empId, orgId]
    );
    return res.rows;
  });

  app.post('/announcements', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const body = (request.body || {}) as any;
    const orgId = resolveViewOrgId(request.user!, body.org_id);
    const res = await query(
      `INSERT INTO announcements (title, body, required, created_by, org_id)
       VALUES ($1,$2,COALESCE($3,true),$4,$5) RETURNING *`,
      [body.title, body.body, body.required, request.user!.employee_id, orgId]
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
    const { org_id } = request.query as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, org_id);

    const ann = await query(`SELECT COALESCE(org_id,'default') as org_id FROM announcements WHERE id = $1`, [id]);
    if (!ann.rows[0] || ann.rows[0].org_id !== orgId) {
      return reply.code(403).send({ error: 'forbidden', message: 'Объявление не принадлежит вашей сети' });
    }

    const read = await query(
      `SELECT e.id, e.full_name, r.read_at
       FROM announcement_reads r
       JOIN employees e ON e.id = r.employee_id
       WHERE r.announcement_id = $1 AND COALESCE(e.org_id,'default') = $2
       ORDER BY r.read_at`,
      [id, orgId]
    );
    const unread = await query(
      `SELECT e.id, e.full_name
       FROM employees e
       WHERE COALESCE(e.is_active, true) = true AND e.access_status = 'active'
         AND COALESCE(e.org_id,'default') = $2
         AND NOT EXISTS (
           SELECT 1 FROM announcement_reads r
           WHERE r.announcement_id = $1 AND r.employee_id = e.id
         )
       ORDER BY e.full_name`,
      [id, orgId]
    );
    return { read: read.rows, unread: unread.rows };
  });

  async function assertChannelInOrg(channelId: string, orgId: string): Promise<boolean> {
    const res = await query(`SELECT COALESCE(org_id,'default') as org_id FROM channels WHERE id = $1`, [channelId]);
    return !!res.rows[0] && res.rows[0].org_id === orgId;
  }

  app.get('/channels/:id/messages', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const { org_id } = request.query as { org_id?: string };
    if (!(await assertChannelInOrg(id, resolveViewOrgId(request.user!, org_id)))) {
      return reply.code(403).send({ error: 'forbidden', message: 'Канал не принадлежит вашей сети' });
    }
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
    if (!(await assertChannelInOrg(id, resolveViewOrgId(request.user!, body.org_id)))) {
      return reply.code(403).send({ error: 'forbidden', message: 'Канал не принадлежит вашей сети' });
    }
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
