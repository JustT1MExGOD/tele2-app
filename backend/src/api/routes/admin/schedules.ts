/**
 * Admin Control Center, Phase 4+ — Schedule Correction Center. Same
 * requireAdmin -> resolveViewOrgId -> reason-required 400 -> try/catch ->
 * errorReply() shape as admin/sales.ts. "Void" is a hard delete here, not
 * a soft-void — see core/admin/schedule-correction.ts's header comment.
 */
import { FastifyInstance } from 'fastify';
import { requireAdmin, resolveViewOrgId } from '../../../auth/guards.js';
import * as schedulesRepo from '../../../data/repositories/schedules.js';
import * as correction from '../../../core/admin/schedule-correction.js';

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

export async function registerAdminSchedulesRoutes(app: FastifyInstance) {
  app.get('/admin/schedules', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const q = request.query as {
      employee_id?: string; store_id?: string; from?: string; to?: string;
      limit?: string; offset?: string; org_id?: string;
    };
    const orgId = resolveViewOrgId(request.user!, q.org_id);
    const items = await schedulesRepo.adminSearchSchedules({
      orgId,
      employeeId: q.employee_id ? Number(q.employee_id) : undefined,
      storeId: q.store_id,
      from: q.from,
      to: q.to,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined
    });
    return { items };
  });

  app.get('/admin/schedules/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const row = await schedulesRepo.findByIdForAdmin(Number(id));
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return { row };
  });

  app.post('/admin/schedules/:id/void/preview', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    try {
      return await correction.previewVoidSchedule(Number(id));
    } catch (e) { return errorReply(reply, e); }
  });

  app.post('/admin/schedules/:id/void', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = request.body as { version: number; reason: string };
    if (!body?.reason?.trim()) return reply.code(400).send({ error: 'reason_required', message: 'Укажите причину' });
    try {
      const row = await correction.voidSchedule({ scheduleId: Number(id), version: Number(body.version), reason: body.reason.trim(), actor: actorFrom(request), requestId: request.id });
      return { row };
    } catch (e) { return errorReply(reply, e); }
  });

  app.post('/admin/schedules/:id/correct/preview', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const { work_date } = request.body as { work_date?: string };
    try {
      return await correction.previewCorrectSchedule(Number(id), work_date);
    } catch (e) { return errorReply(reply, e); }
  });

  app.post('/admin/schedules/:id/correct', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = request.body as { version: number; store_id?: string; work_date?: string; hours?: number; reason: string };
    if (!body?.reason?.trim()) return reply.code(400).send({ error: 'reason_required', message: 'Укажите причину' });
    try {
      const row = await correction.correctSchedule({
        scheduleId: Number(id), version: Number(body.version), storeId: body.store_id, workDate: body.work_date,
        hours: body.hours !== undefined ? Number(body.hours) : undefined, reason: body.reason.trim(), actor: actorFrom(request), requestId: request.id
      });
      return { row };
    } catch (e) { return errorReply(reply, e); }
  });
}
