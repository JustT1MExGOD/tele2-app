/**
 * Промокоды RTK.
 * Вынесено из index.ts при разбиении монолита на модули.
 */
import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';

function maskPromoCode(code: string) {
  const s = String(code || '');
  if (s.length <= 4) return '••••';
  return s.slice(0, 2) + '•'.repeat(Math.min(8, s.length - 4)) + s.slice(-2);
}

function resolveEmployeeFromRequest(request: any): {
  employee_id: number;
  full_name: string;
  role: string;
} | null {
  const u = request.user;
  if (!u || !u.employee_id || u.access_status !== 'active') return null;
  return { employee_id: u.employee_id, full_name: u.full_name || '', role: u.role };
}

export async function registerPromosRoutes(app: FastifyInstance) {
  app.get('/promos', async (request, reply) => {
    const user = resolveEmployeeFromRequest(request);
    if (!user) return reply.code(401).send({ error: 'unauthorized', message: 'Привяжите Telegram' });
    try {
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
          mask: maskPromoCode(r.code),
          note: r.note,
          created_by_name: r.created_by_name,
          created_at: r.created_at
        }))
      };
    } catch (e: any) {
      return reply.code(500).send({
        error: 'db_error',
        message: e?.message || String(e),
        hint: 'CREATE TABLE rtk_promocodes — sql/promos.sql'
      });
    }
  });

  app.get('/promos/:id', async (request, reply) => {
    const user = resolveEmployeeFromRequest(request);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const id = Number((request.params as any).id);
    try {
      const res = await query(
        `SELECT id, code, note, created_by_name, created_at
         FROM rtk_promocodes WHERE id = $1 AND is_used = false`,
        [id]
      );
      if (!res.rows[0]) return reply.code(404).send({ error: 'not_found' });
      return res.rows[0];
    } catch (e: any) {
      return reply.code(500).send({ error: 'db_error', message: e?.message || String(e) });
    }
  });

  app.post('/promos', async (request, reply) => {
    const user = resolveEmployeeFromRequest(request);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const body = (request.body as any) || {};
    const code = String(body.code || '').trim();
    if (!code) return reply.code(400).send({ error: 'code_required' });
    const note = body.note ? String(body.note).slice(0, 200) : null;
    try {
      const res = await query(
        `INSERT INTO rtk_promocodes (code, note, created_by, created_by_name)
         VALUES ($1, $2, $3, $4)
         RETURNING id, code, note, created_at`,
        [code, note, user.employee_id, user.full_name]
      );
      return { ok: true, item: res.rows[0] };
    } catch (e: any) {
      return reply.code(500).send({
        error: 'db_error',
        message: e?.message || String(e),
        hint: 'Таблица rtk_promocodes не создана'
      });
    }
  });

  app.post('/promos/:id/use', async (request, reply) => {
    const user = resolveEmployeeFromRequest(request);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const id = Number((request.params as any).id);
    try {
      const res = await query(
        `UPDATE rtk_promocodes
         SET is_used = true, used_by = $2, used_at = now()
         WHERE id = $1 AND is_used = false
         RETURNING id`,
        [id, user.employee_id]
      );
      if (!res.rows[0]) return reply.code(404).send({ error: 'not_found' });
      return { ok: true, used: true };
    } catch (e: any) {
      return reply.code(500).send({ error: 'db_error', message: e?.message || String(e) });
    }
  });

  app.post('/promos/:id/keep', async (request, reply) => {
    const user = resolveEmployeeFromRequest(request);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    return { ok: true, used: false };
  });
}
