/**
 * Admin Control Center, Phase 4+ — Plan Correction Center. No void (plans
 * have no void concept, zeroing every metric already models "no plan"),
 * no step-up (no org-transfer concept for a plan) — just single-metric
 * correct for employee and store month plans. Same
 * requireAdmin -> reason-required 400 -> try/catch -> errorReply() shape
 * as admin/sales.ts.
 */
import { FastifyInstance } from 'fastify';
import { requireAdmin } from '../../../auth/guards.js';
import { findEmployeeMonthPlanById, findStoreMonthPlanById } from '../../../core/plans/index.js';
import * as correction from '../../../core/admin/plan-correction.js';

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

export async function registerAdminPlansRoutes(app: FastifyInstance) {
  app.get('/admin/plans/employees/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const row = await findEmployeeMonthPlanById(Number(id));
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const metrics = await correction.planMetricsView(row);
    return { row, metrics };
  });

  app.post('/admin/plans/employees/:id/correct-metric', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = request.body as { metric: string; value: number; version: number; reason: string };
    if (!body?.reason?.trim()) return reply.code(400).send({ error: 'reason_required', message: 'Укажите причину' });
    if (!body?.metric) return reply.code(400).send({ error: 'metric_required', message: 'Укажите метрику' });
    try {
      const row = await correction.correctEmployeePlanMetric({
        planId: Number(id), metric: body.metric, value: Number(body.value), version: Number(body.version),
        reason: body.reason.trim(), actor: actorFrom(request), requestId: request.id
      });
      const metrics = await correction.planMetricsView(row);
      return { row, metrics };
    } catch (e) { return errorReply(reply, e); }
  });

  app.get('/admin/plans/stores/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const row = await findStoreMonthPlanById(Number(id));
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const metrics = await correction.planMetricsView(row);
    return { row, metrics };
  });

  app.post('/admin/plans/stores/:id/correct-metric', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = request.body as { metric: string; value: number; version: number; reason: string };
    if (!body?.reason?.trim()) return reply.code(400).send({ error: 'reason_required', message: 'Укажите причину' });
    if (!body?.metric) return reply.code(400).send({ error: 'metric_required', message: 'Укажите метрику' });
    try {
      const row = await correction.correctStorePlanMetric({
        planId: Number(id), metric: body.metric, value: Number(body.value), version: Number(body.version),
        reason: body.reason.trim(), actor: actorFrom(request), requestId: request.id
      });
      const metrics = await correction.planMetricsView(row);
      return { row, metrics };
    } catch (e) { return errorReply(reply, e); }
  });
}
