/**
 * Промокоды РТК
 * GET  /promos          — активные (код маскируется)
 * POST /promos          — добавить { code, note? }
 * POST /promos/:id/use  — использован → soft-delete (is_used)
 * POST /promos/:id/keep — не использован (no-op, для UX)
 */
import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import { authPlugin, requireAuth, requireActive } from './middleware-auth.js';

function maskCode(code: string) {
  const s = String(code || '');
  if (s.length <= 4) return '••••';
  return s.slice(0, 2) + '•'.repeat(Math.min(8, s.length - 4)) + s.slice(-2);
}

export async function registerPromoRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authPlugin);

  app.get('/promos', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!requireActive(request, reply)) return;
    const res = await query(
      `SELECT id, code, note, created_by, created_by_name, created_at
       FROM rtk_promocodes
       WHERE is_used = false
       ORDER BY created_at DESC
       LIMIT 200`
    );
    return {
      items: res.rows.map((r: any) => ({
        id: r.id,
        mask: maskCode(r.code),
        note: r.note,
        created_by_name: r.created_by_name,
        created_at: r.created_at
      }))
    };
  });

  app.get('/promos/:id', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!requireActive(request, reply)) return;
    const id = Number((request.params as any).id);
    const res = await query(
      `SELECT id, code, note, created_by_name, created_at
       FROM rtk_promocodes WHERE id = $1 AND is_used = false`,
      [id]
    );
    if (!res.rows[0]) return reply.code(404).send({ error: 'not_found' });
    return res.rows[0];
  });

  app.post('/promos', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!requireActive(request, reply)) return;
    const body = (request.body as any) || {};
    const code = String(body.code || '').trim();
    if (!code) return reply.code(400).send({ error: 'code_required' });
    const note = body.note ? String(body.note).slice(0, 200) : null;
    const res = await query(
      `INSERT INTO rtk_promocodes (code, note, created_by, created_by_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, code, note, created_at`,
      [code, note, request.user!.employee_id, request.user!.full_name]
    );
    return { ok: true, item: res.rows[0] };
  });

  app.post('/promos/:id/use', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!requireActive(request, reply)) return;
    const id = Number((request.params as any).id);
    const res = await query(
      `UPDATE rtk_promocodes
       SET is_used = true, used_by = $2, used_at = now()
       WHERE id = $1 AND is_used = false
       RETURNING id`,
      [id, request.user!.employee_id]
    );
    if (!res.rows[0]) return reply.code(404).send({ error: 'not_found' });
    return { ok: true, used: true };
  });

  app.post('/promos/:id/keep', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    return { ok: true, used: false };
  });
}
