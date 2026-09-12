/**
 * Admin Control Center (20.59.0) — Store admin: detail + edit/
 * activate/deactivate. Reuses stores.ts repo writes as-is (already
 * org-scoped) — nothing new at the data layer.
 */
import { FastifyInstance } from 'fastify';
import { requireAdmin, resolveViewOrgId } from '../../../auth/guards.js';
import { record as recordAudit } from '../../../data/repositories/audit.js';
import * as storesRepo from '../../../data/repositories/stores.js';

function actorFields(request: any) {
  return {
    actorEmployeeId: request.user!.employee_id,
    actorTelegramId: request.user!.telegram_id ? Number(request.user!.telegram_id) : null,
    actorRole: request.user!.role
  };
}

export async function registerAdminStoresRoutes(app: FastifyInstance) {
  app.get('/admin/stores', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const orgId = resolveViewOrgId(request.user!, (request.query as any)?.org_id);
    const items = await storesRepo.listWithDisplayName(orgId);
    return { items };
  });

  app.get('/admin/stores/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const orgId = resolveViewOrgId(request.user!, (request.query as any)?.org_id);
    const store = await storesRepo.findById(orgId, id);
    if (!store) return reply.code(404).send({ error: 'not_found' });
    return { store };
  });

  app.patch('/admin/stores/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, any>;
    const orgId = resolveViewOrgId(request.user!, body.org_id);
    const before = await storesRepo.findById(orgId, id);
    if (!before) return reply.code(404).send({ error: 'not_found' });
    const { org_id, ...patch } = body;
    const updated = await storesRepo.update(orgId, id, patch);
    await recordAudit({
      orgId, ...actorFields(request), action: 'admin.store_edit',
      targetType: 'store', targetId: id, before, after: patch, requestId: request.id
    });
    return { store: updated };
  });

  app.post('/admin/stores/:id/deactivate', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const orgId = resolveViewOrgId(request.user!, (request.body as any)?.org_id);
    const ok = await storesRepo.softDelete(orgId, id);
    if (!ok) return reply.code(404).send({ error: 'not_found' });
    await recordAudit({
      orgId, ...actorFields(request), action: 'admin.store_deactivate',
      targetType: 'store', targetId: id, before: { is_active: true }, after: { is_active: false }, requestId: request.id
    });
    return { ok: true };
  });

  app.post('/admin/stores/:id/reactivate', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const orgId = resolveViewOrgId(request.user!, (request.body as any)?.org_id);
    const updated = await storesRepo.update(orgId, id, { is_active: true } as any);
    if (!updated) return reply.code(404).send({ error: 'not_found' });
    await recordAudit({
      orgId, ...actorFields(request), action: 'admin.store_reactivate',
      targetType: 'store', targetId: id, before: { is_active: false }, after: { is_active: true }, requestId: request.id
    });
    return { store: updated };
  });
}
