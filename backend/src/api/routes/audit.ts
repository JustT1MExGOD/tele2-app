/**
 * Чтение audit_log (19.23.0) — admin-only, своя сеть всегда (тот же
 * resolveViewOrgId, что везде). Пишущая сторона — src/data/repositories/audit.ts,
 * вызывается из тех роутов, что реально совершают чувствительные действия.
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import * as auditRepo from '../../data/repositories/audit.js';
import { requireManager, resolveViewOrgId } from '../../auth/guards.js';
import type { AuditListResponse } from '../../shared/api-types.js';

export async function registerAuditRoutes(app: FastifyInstance) {
  app.get('/audit', async (request, reply): Promise<AuditListResponse | FastifyReply | undefined> => {
    if (!requireManager(request, reply)) return;
    if (request.user!.role !== 'admin') {
      return reply.code(403).send({ error: 'admin only' });
    }
    const q = request.query as { action?: string; target_type?: string; from?: string; to?: string; limit?: string; offset?: string };
    const orgId = resolveViewOrgId(request.user!, undefined);

    const items = await auditRepo.list({
      orgId,
      action: q.action,
      targetType: q.target_type,
      from: q.from,
      to: q.to,
      limit: Number(q.limit) || undefined,
      offset: Number(q.offset) || undefined
    });
    return { items };
  });
}
