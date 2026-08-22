/**
 * Чтение audit_log (19.23.0) — admin-only, своя сеть всегда (тот же
 * resolveViewOrgId, что везде). Пишущая сторона — src/services/audit.ts,
 * вызывается из тех роутов, что реально совершают чувствительные действия.
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { query } from './db/index.js';
import { requireManager, resolveViewOrgId } from './middleware-auth.js';
import type { AuditListResponse } from './shared/api-types.js';

export async function registerAuditRoutes(app: FastifyInstance) {
  app.get('/audit', async (request, reply): Promise<AuditListResponse | FastifyReply | undefined> => {
    if (!requireManager(request, reply)) return;
    if (request.user!.role !== 'admin') {
      return reply.code(403).send({ error: 'admin only' });
    }
    const q = request.query as { action?: string; target_type?: string; from?: string; to?: string; limit?: string; offset?: string };
    const orgId = resolveViewOrgId(request.user!, undefined);

    const conditions = ['COALESCE(a.org_id, \'default\') = $1'];
    const params: any[] = [orgId];
    if (q.action) {
      params.push(q.action);
      conditions.push(`a.action = $${params.length}`);
    }
    if (q.target_type) {
      params.push(q.target_type);
      conditions.push(`a.target_type = $${params.length}`);
    }
    if (q.from) {
      params.push(q.from);
      conditions.push(`a.created_at >= $${params.length}`);
    }
    if (q.to) {
      params.push(q.to);
      conditions.push(`a.created_at <= $${params.length}`);
    }
    const limit = Math.min(Number(q.limit) || 100, 500);
    const offset = Math.max(Number(q.offset) || 0, 0);
    params.push(limit, offset);

    const res = await query(
      `SELECT a.*, e.full_name as actor_name
       FROM audit_log a
       LEFT JOIN employees e ON e.id = a.actor_employee_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY a.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { items: res.rows };
  });
}
