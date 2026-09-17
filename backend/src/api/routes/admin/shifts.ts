/**
 * Admin Control Center, Phase 4+ — Shift Correction Center. Same shape as
 * api/routes/admin/sales.ts: requireAdmin -> resolveViewOrgId ->
 * reason-required 400 -> try/catch -> errorReply().
 */
import { FastifyInstance } from 'fastify';
import { requireAdmin, resolveViewOrgId } from '../../../auth/guards.js';
import { assertStepUp } from '../../../auth/step-up.js';
import * as shiftsRepo from '../../../data/repositories/shifts.js';
import * as correction from '../../../core/admin/shift-correction.js';

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

export async function registerAdminShiftsRoutes(app: FastifyInstance) {
  app.get('/admin/shifts', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const q = request.query as {
      employee_id?: string; store_id?: string; from?: string; to?: string;
      include_voided?: string; limit?: string; offset?: string; org_id?: string;
    };
    const orgId = resolveViewOrgId(request.user!, q.org_id);
    const items = await shiftsRepo.adminSearchShifts({
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

  app.get('/admin/shifts/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const row = await shiftsRepo.findByIdForAdmin(Number(id));
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return { row };
  });

  app.post('/admin/shifts/:id/void/preview', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    try {
      return await correction.previewVoidShift(Number(id));
    } catch (e) { return errorReply(reply, e); }
  });

  app.post('/admin/shifts/:id/void', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = request.body as { version: number; reason: string };
    if (!body?.reason?.trim()) return reply.code(400).send({ error: 'reason_required', message: 'Укажите причину' });
    try {
      const row = await correction.voidShift({ sessionId: Number(id), version: Number(body.version), reason: body.reason.trim(), actor: actorFrom(request), requestId: request.id });
      return { row };
    } catch (e) { return errorReply(reply, e); }
  });

  app.post('/admin/shifts/:id/restore', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = request.body as { version: number; reason: string };
    if (!body?.reason?.trim()) return reply.code(400).send({ error: 'reason_required', message: 'Укажите причину' });
    try {
      const row = await correction.restoreShift({ sessionId: Number(id), version: Number(body.version), reason: body.reason.trim(), actor: actorFrom(request), requestId: request.id });
      return { row };
    } catch (e) { return errorReply(reply, e); }
  });

  app.post('/admin/shifts/:id/correct/preview', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const { new_store_id } = request.body as { new_store_id?: string };
    try {
      return await correction.previewCorrectShift(Number(id), new_store_id);
    } catch (e) { return errorReply(reply, e); }
  });

  app.post('/admin/shifts/:id/correct', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = request.body as { version: number; new_store_id?: string; work_date?: string; reason: string };
    if (!body?.reason?.trim()) return reply.code(400).send({ error: 'reason_required', message: 'Укажите причину' });

    // Same cheap pre-check / real-enforcement split as admin/sales.ts's
    // correct-store route: this only decides whether to demand the
    // step-up header at all; correction.correctShift() re-derives
    // crossOrg itself inside the transaction.
    const preview = await correction.previewCorrectShift(Number(id), body.new_store_id).catch(() => null);
    let stepUpVerified = false;
    if (preview?.crossOrg) {
      if (!(await assertStepUp(request, reply))) return;
      stepUpVerified = true;
    }

    try {
      const row = await correction.correctShift({
        sessionId: Number(id), version: Number(body.version), newStoreId: body.new_store_id, workDate: body.work_date,
        reason: body.reason.trim(), actor: actorFrom(request), stepUpVerified, requestId: request.id
      });
      return { row };
    } catch (e) { return errorReply(reply, e); }
  });
}
