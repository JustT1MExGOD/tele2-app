/**
 * Черновики автоматических персональных планов на следующий месяц
 * (DRAFT -> APPLY, миграция 0029). См. core/plans/employee-plan-generator.ts
 * для формулы. Только manager/supervisor своей сети.
 *
 * await registerEmployeePlanDraftsRoutes(app);
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { requireManager, requireActive, resolveViewOrgId } from '../../auth/guards.js';
import { record as recordAudit } from '../../data/repositories/audit.js';
import {
  generateDraft, viewDraft, applyDraft, defaultTargetMonth,
  StaleDraftError, DraftHasBlockingErrorsError
} from '../../core/plans/index.js';

export async function registerEmployeePlanDraftsRoutes(app: FastifyInstance) {
  // Рассчитать (или пересчитать) черновик планов на следующий месяц.
  app.post('/plans/employees/month-drafts', async (request, reply): Promise<any | FastifyReply> => {
    if (!requireManager(request, reply)) return;
    const body = (request.body || {}) as { month?: string; org_id?: string };
    const orgId = resolveViewOrgId(request.user!, body.org_id);
    // Передаём body.month как есть (может быть undefined) — generateDraft сам
    // решает, использовать ли явно выбранный месяц или старое поведение
    // "следующий месяц" при отсутствии month (backward compatibility).
    const result = await generateDraft(orgId, body.month, request.user!.employee_id);

    await recordAudit({
      orgId, actorEmployeeId: request.user!.employee_id,
      actorTelegramId: request.user!.telegram_id ? Number(request.user!.telegram_id) : null,
      action: 'plan_draft.generate', targetType: 'employee_plan_draft', targetId: String(result.draft.id),
      after: { month: result.draft.month, employees: result.items.length, blocking_errors: result.blocking_errors.length },
      requestId: request.id, actorRole: request.user!.role
    });

    return {
      draft_id: result.draft.id, month: result.draft.month, status: result.draft.status,
      blocking_errors: result.blocking_errors, items: result.items
    };
  });

  // Последний черновик на месяц (или явный draft_id).
  app.get('/plans/employees/month-drafts/latest', async (request, reply): Promise<any | FastifyReply> => {
    if (!requireManager(request, reply)) return;
    const { month, org_id } = request.query as { month?: string; org_id?: string };
    const orgId = resolveViewOrgId(request.user!, org_id);
    const draftsRepo = await import('../../data/repositories/employee-plan-drafts.js');
    const draft = await draftsRepo.findLatestDraft(orgId, month || defaultTargetMonth());
    if (!draft) return { draft: null, items: [] };
    const items = await draftsRepo.listDraftItems(draft.id);
    return { draft, items };
  });

  app.get('/plans/employees/month-drafts/:id', async (request, reply): Promise<any | FastifyReply> => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const { org_id } = request.query as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, org_id);
    const result = await viewDraft(Number(id), orgId);
    if (!result) return reply.code(404).send({ error: 'not_found', message: 'Черновик не найден' });
    return result;
  });

  // Применить черновик — записывает employee_month_plans, транзакционно, идемпотентно.
  app.post('/plans/employees/month-drafts/:id/apply', async (request, reply): Promise<any | FastifyReply> => {
    if (!requireActive(request, reply)) return;
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, body.org_id);

    try {
      const result = await applyDraft(Number(id), orgId, request.user!.employee_id);

      await recordAudit({
        orgId, actorEmployeeId: request.user!.employee_id,
        actorTelegramId: request.user!.telegram_id ? Number(request.user!.telegram_id) : null,
        action: 'plan_draft.apply', targetType: 'employee_plan_draft', targetId: id,
        after: { applied: result.applied, status: result.draft.status },
        requestId: request.id, actorRole: request.user!.role
      });

      return result;
    } catch (e: any) {
      if (e instanceof StaleDraftError) return reply.code(409).send({ error: 'stale_draft', message: e.message });
      if (e instanceof DraftHasBlockingErrorsError) return reply.code(422).send({ error: 'blocking_errors', message: e.message, errors: e.errors });
      throw e;
    }
  });
}
