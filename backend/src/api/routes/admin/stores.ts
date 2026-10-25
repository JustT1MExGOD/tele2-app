/**
 * Admin Control Center (20.59.0) — Store admin: detail + edit/
 * activate/deactivate. Reuses stores.ts repo writes as-is (already
 * org-scoped) — nothing new at the data layer.
 */
import { FastifyInstance } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { requireAdmin, resolveViewOrgId } from '../../../auth/guards.js';
import { record as recordAudit } from '../../../data/repositories/audit.js';
import * as storesRepo from '../../../data/repositories/stores.js';
import * as orgsRepo from '../../../data/repositories/organizations.js';

const MoveStoreBody = Type.Object({
  toOrgId: Type.String({ minLength: 1, maxLength: 64 }),
  org_id: Type.Optional(Type.String({ maxLength: 64 }))
});
type MoveStoreBody = Static<typeof MoveStoreBody>;

// Цвет точки в графике. Остальные поля PATCH по-прежнему не типизированы
// (additionalProperties), но color подставляется без esc() в inline
// style="..." на фронтенде (storeColor()), поэтому формат фиксируется на
// входе — тот же контракт, что в org/stores.ts (hotfix 20.57.1, finding #5).
const PatchStoreBody = Type.Object(
  {
    color: Type.Optional(Type.String({ pattern: '^#[0-9a-fA-F]{6}$' })),
    org_id: Type.Optional(Type.String({ maxLength: 64 }))
  },
  { additionalProperties: true }
);

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

  app.patch('/admin/stores/:id', { schema: { body: PatchStoreBody } }, async (request, reply) => {
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

  // §D плана (глобальная админка) — перенос точки в другую сеть, в т.ч.
  // другого дилера (той же дисциплины достаточно: toOrgId должен
  // существовать, fromOrgId — текущая сеть через resolveViewOrgId).
  app.post(
    '/admin/stores/:id/move',
    { schema: { body: MoveStoreBody } },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const { id } = request.params as { id: string };
      const { toOrgId, org_id } = request.body as MoveStoreBody;
      const fromOrgId = resolveViewOrgId(request.user!, org_id);
      if (!(await orgsRepo.findActiveById(toOrgId))) {
        return reply.code(404).send({ error: 'target_org_not_found', message: 'Целевая сеть не найдена' });
      }
      const updated = await storesRepo.moveToOrg(id, fromOrgId, toOrgId);
      if (!updated) return reply.code(404).send({ error: 'not_found' });
      await recordAudit({
        orgId: fromOrgId, ...actorFields(request), action: 'admin.store_moved',
        targetType: 'store', targetId: id, before: { org_id: fromOrgId }, after: { org_id: toOrgId }, requestId: request.id
      });
      return { store: updated };
    }
  );
}
