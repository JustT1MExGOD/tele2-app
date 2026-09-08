/**
 * Автоматический генератор месячного графика (DRAFT -> APPLY, миграция
 * 0030) + минимальный CRUD для конфигурации покрытия/доступности, на
 * которых он строится. См. core/schedule/schedule-generator.ts для
 * формулы. Только manager/supervisor своей сети — requireManager везде.
 *
 * await registerScheduleDraftsRoutes(app);
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { requireManager, requireActive, resolveViewOrgId, requireStoreInOrg, requireEmployeeInOrg } from '../../auth/guards.js';
import { record as recordAudit } from '../../data/repositories/audit.js';
import * as staffingRepo from '../../data/repositories/store-staffing.js';
import * as availabilityRepo from '../../data/repositories/employee-availability.js';
import {
  generateDraft, viewDraft, applyDraft, defaultTargetMonth,
  StaleDraftError, DraftHasBlockingErrorsError
} from '../../core/schedules/index.js';

export async function registerScheduleDraftsRoutes(app: FastifyInstance) {
  // Рассчитать (или пересчитать) черновик графика на месяц.
  app.post('/schedule-drafts/generate', async (request, reply): Promise<any | FastifyReply> => {
    if (!requireManager(request, reply)) return;
    const body = (request.body || {}) as { month?: string; org_id?: string };
    const orgId = resolveViewOrgId(request.user!, body.org_id);
    const result = await generateDraft(orgId, body.month || defaultTargetMonth(), request.user!.employee_id);

    await recordAudit({
      orgId, actorEmployeeId: request.user!.employee_id,
      actorTelegramId: request.user!.telegram_id ? Number(request.user!.telegram_id) : null,
      action: 'schedule_draft.generate', targetType: 'schedule_draft', targetId: String(result.draft.id),
      after: { month: result.draft.month, solver_status: result.draft.solver_status, items: result.items.length, blocking_errors: result.blocking_errors.length },
      requestId: request.id, actorRole: request.user!.role
    });

    return {
      draft_id: result.draft.id, month: result.draft.month, status: result.draft.status,
      solver_status: result.draft.solver_status, blocking_errors: result.blocking_errors, items: result.items
    };
  });

  app.get('/schedule-drafts/:id', async (request, reply): Promise<any | FastifyReply> => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const { org_id } = request.query as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, org_id);
    const result = await viewDraft(Number(id), orgId);
    if (!result) return reply.code(404).send({ error: 'not_found', message: 'Черновик не найден' });
    return result;
  });

  // Применить черновик — записывает schedules, транзакционно, идемпотентно.
  app.post('/schedule-drafts/:id/apply', async (request, reply): Promise<any | FastifyReply> => {
    if (!requireActive(request, reply)) return;
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { org_id?: string; replace?: boolean };
    const orgId = resolveViewOrgId(request.user!, body.org_id);

    try {
      const result = await applyDraft(Number(id), orgId, request.user!.employee_id, body.replace === true);

      if (result.applied) {
        await recordAudit({
          orgId, actorEmployeeId: request.user!.employee_id,
          actorTelegramId: request.user!.telegram_id ? Number(request.user!.telegram_id) : null,
          action: 'schedule_draft.apply', targetType: 'schedule_draft', targetId: id,
          after: { applied: result.applied, status: result.draft.status, replace: body.replace === true },
          requestId: request.id, actorRole: request.user!.role
        });
      }

      return result;
    } catch (e: any) {
      if (e instanceof StaleDraftError) return reply.code(409).send({ error: 'stale_draft', message: e.message });
      if (e instanceof DraftHasBlockingErrorsError) return reply.code(422).send({ error: 'blocking_errors', message: e.message, errors: e.errors });
      throw e;
    }
  });

  // --- Конфигурация покрытия точки (store_staffing_requirements) ---

  app.get('/stores/:id/staffing-requirements', {
    preHandler: requireStoreInOrg('params', 'id')
  }, async (request, reply): Promise<any | FastifyReply> => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const { org_id } = request.query as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, org_id);
    return { rows: await staffingRepo.listForStore(orgId, id) };
  });

  app.put('/stores/:id/staffing-requirements', {
    preHandler: requireStoreInOrg('params', 'id')
  }, async (request, reply): Promise<any | FastifyReply> => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as {
      org_id?: string;
      weekday_rows?: { weekday: number; required_employees: number; max_trainees?: number }[];
      date_rows?: { specific_date: string; required_employees: number; max_trainees?: number }[];
    };
    const orgId = resolveViewOrgId(request.user!, body.org_id);

    const saved: any[] = [];
    for (const row of body.weekday_rows || []) {
      saved.push(await staffingRepo.upsertWeekdayRow(orgId, id, row.weekday, row.required_employees, row.max_trainees ?? 1));
    }
    for (const row of body.date_rows || []) {
      saved.push(await staffingRepo.upsertDateRow(orgId, id, row.specific_date, row.required_employees, row.max_trainees ?? 1));
    }

    await recordAudit({
      orgId, actorEmployeeId: request.user!.employee_id,
      actorTelegramId: request.user!.telegram_id ? Number(request.user!.telegram_id) : null,
      action: 'staffing_requirements.update', targetType: 'store', targetId: id,
      after: { weekday_rows: (body.weekday_rows || []).length, date_rows: (body.date_rows || []).length },
      requestId: request.id, actorRole: request.user!.role
    });

    return { rows: await staffingRepo.listForStore(orgId, id) };
  });

  // --- Доступность сотрудника (employee_schedule_preferences: unavailable/vacation) ---

  app.get('/employees/:id/schedule-availability', {
    preHandler: requireEmployeeInOrg('params', 'id')
  }, async (request, reply): Promise<any | FastifyReply> => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const { org_id } = request.query as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, org_id);
    return { rows: await availabilityRepo.listUnavailableForEmployee(orgId, Number(id)) };
  });

  app.post('/employees/:id/schedule-availability', {
    preHandler: requireEmployeeInOrg('params', 'id')
  }, async (request, reply): Promise<any | FastifyReply> => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { org_id?: string; kind?: 'unavailable' | 'vacation'; specific_date?: string };
    const orgId = resolveViewOrgId(request.user!, body.org_id);
    if (!body.kind || !['unavailable', 'vacation'].includes(body.kind) || !body.specific_date) {
      return reply.code(400).send({ error: 'invalid_body', message: 'Нужны kind (unavailable|vacation) и specific_date' });
    }
    const row = await availabilityRepo.addUnavailable(orgId, Number(id), body.kind, body.specific_date, request.user!.employee_id);

    await recordAudit({
      orgId, actorEmployeeId: request.user!.employee_id,
      actorTelegramId: request.user!.telegram_id ? Number(request.user!.telegram_id) : null,
      action: 'schedule_availability.add', targetType: 'employee', targetId: id,
      after: { kind: body.kind, specific_date: body.specific_date },
      requestId: request.id, actorRole: request.user!.role
    });

    return row;
  });

  app.delete('/employees/:id/schedule-availability/:rowId', {
    preHandler: requireEmployeeInOrg('params', 'id')
  }, async (request, reply): Promise<any | FastifyReply> => {
    if (!requireManager(request, reply)) return;
    const { id, rowId } = request.params as { id: string; rowId: string };
    const body = (request.body || {}) as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, body.org_id);
    await availabilityRepo.deleteRow(orgId, Number(id), Number(rowId));

    await recordAudit({
      orgId, actorEmployeeId: request.user!.employee_id,
      actorTelegramId: request.user!.telegram_id ? Number(request.user!.telegram_id) : null,
      action: 'schedule_availability.delete', targetType: 'employee', targetId: id,
      after: { row_id: Number(rowId) },
      requestId: request.id, actorRole: request.user!.role
    });

    return { ok: true };
  });
}
