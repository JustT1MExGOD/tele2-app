/**
 * Admin Control Center (20.59.0) — Sales Correction Center.
 * admin-only (requireAdmin), org-scoped via resolveViewOrgId. See
 * core/admin/sales-correction.ts for why "sale" means the (employee,
 * store, sale_date) day-row, not a per-transaction entity.
 */
import { FastifyInstance } from 'fastify';
import { requireAdmin, resolveViewOrgId } from '../../../auth/guards.js';
import { assertStepUp } from '../../../auth/step-up.js';
import * as salesRepo from '../../../data/repositories/sales.js';
import * as correction from '../../../core/admin/sales-correction.js';

function actorFrom(request: any) {
  return {
    employeeId: request.user!.employee_id,
    telegramId: request.user!.telegram_id ? Number(request.user!.telegram_id) : null,
    role: request.user!.role
  };
}

function errorReply(reply: any, e: any) {
  const status = e?.statusCode || 500;
  return reply.code(status).send({ error: e?.code || e?.name || 'error', message: e?.message || 'Internal error' });
}

export async function registerAdminSalesRoutes(app: FastifyInstance) {
  app.get('/admin/sales', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const q = request.query as {
      employee_id?: string; store_id?: string; from?: string; to?: string;
      include_voided?: string; limit?: string; offset?: string; org_id?: string;
    };
    const orgId = resolveViewOrgId(request.user!, q.org_id);
    const items = await salesRepo.adminSearchSales({
      orgId,
      employeeId: q.employee_id ? Number(q.employee_id) : undefined,
      storeId: q.store_id,
      from: q.from,
      to: q.to,
      includeVoided: q.include_voided === '1' || q.include_voided === 'true',
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined
    });
    return { items };
  });

  app.get('/admin/sales/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const row = await salesRepo.findByIdForAdmin(id);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return { row };
  });

  app.post('/admin/sales/:id/void/preview', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    try {
      return await correction.previewVoidSale(id);
    } catch (e) { return errorReply(reply, e); }
  });

  app.post('/admin/sales/:id/void', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = request.body as { version: number; reason: string };
    if (!body?.reason?.trim()) return reply.code(400).send({ error: 'reason_required', message: 'Укажите причину' });
    try {
      const row = await correction.voidSale({ saleId: id, version: Number(body.version), reason: body.reason.trim(), actor: actorFrom(request), requestId: request.id });
      return { row };
    } catch (e) { return errorReply(reply, e); }
  });

  app.post('/admin/sales/:id/restore', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = request.body as { version: number; reason: string };
    if (!body?.reason?.trim()) return reply.code(400).send({ error: 'reason_required', message: 'Укажите причину' });
    try {
      const row = await correction.restoreSale({ saleId: id, version: Number(body.version), reason: body.reason.trim(), actor: actorFrom(request), requestId: request.id });
      return { row };
    } catch (e) { return errorReply(reply, e); }
  });

  app.post('/admin/sales/:id/correct-store/preview', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const { new_store_id } = request.body as { new_store_id: string };
    try {
      return await correction.previewCorrectSaleStore(id, new_store_id);
    } catch (e) { return errorReply(reply, e); }
  });

  app.post('/admin/sales/:id/correct-store', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = request.body as { version: number; new_store_id: string; reason: string };
    if (!body?.reason?.trim()) return reply.code(400).send({ error: 'reason_required', message: 'Укажите причину' });

    // §41: cross-org correction needs a fresh step-up ticket; same-org
    // does not. Cheap pre-check against the row's own org here decides
    // whether to demand the header at all — correction.correctSaleStore()
    // re-derives crossOrg itself inside the transaction and is the real
    // enforcement point (this is only so a same-org admin never has to
    // go get an MFA ticket for an ordinary same-network correction).
    const preview = await correction.previewCorrectSaleStore(id, body.new_store_id).catch(() => null);
    let stepUpVerified = false;
    if (preview?.crossOrg) {
      if (!(await assertStepUp(request, reply))) return;
      stepUpVerified = true;
    }

    try {
      const row = await correction.correctSaleStore({
        saleId: id, version: Number(body.version), newStoreId: body.new_store_id,
        reason: body.reason.trim(), actor: actorFrom(request), stepUpVerified, requestId: request.id
      });
      return { row };
    } catch (e) { return errorReply(reply, e); }
  });
}
