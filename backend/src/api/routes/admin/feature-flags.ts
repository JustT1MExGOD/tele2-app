/**
 * Admin Control Center, Phase 4+ (Area B1) — Feature Flags. Plain
 * admin-CRUD, no reason/version/step-up: flipping a flag isn't a
 * retroactive correction like the sales/shift/schedule/plan corrections.
 */
import { FastifyInstance } from 'fastify';
import { requireAdmin } from '../../../auth/guards.js';
import * as repo from '../../../data/repositories/feature-flags.js';
import { invalidateFeatureFlagsCache } from '../../../core/shared/feature-flags.js';

export async function registerAdminFeatureFlagsRoutes(app: FastifyInstance) {
  app.get('/admin/feature-flags', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const items = await repo.listAll();
    return { items };
  });

  app.put('/admin/feature-flags/:key', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { key } = request.params as { key: string };
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) {
      return reply.code(400).send({ error: 'invalid_key', message: 'key: a-z, 0-9, _' });
    }
    const body = request.body as { org_id?: string | null; enabled: boolean; description?: string | null };
    if (typeof body?.enabled !== 'boolean') {
      return reply.code(400).send({ error: 'enabled_required' });
    }
    const row = await repo.upsert(key, body.org_id ?? null, body.enabled, body.description ?? null, request.user!.employee_id);
    invalidateFeatureFlagsCache();
    return { row };
  });

  app.delete('/admin/feature-flags/:key', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { key } = request.params as { key: string };
    const { org_id } = request.query as { org_id?: string };
    const removed = await repo.remove(key, org_id ?? null);
    invalidateFeatureFlagsCache();
    return { ok: removed };
  });
}
