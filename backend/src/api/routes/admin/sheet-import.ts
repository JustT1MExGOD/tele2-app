/**
 * Admin Control Center — подтверждение нечётких соответствий "имя из
 * Google Таблицы -> сотрудник" (см. docs/SHEET-SCHEDULE-IMPORT.md,
 * core/integrations/sheet-schedule-import.ts). Ничего не пишет в график
 * само по себе — только подтверждает/отклоняет уже накопленные
 * sheet_schedule_pending строки.
 */
import { FastifyInstance } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { requireAdmin, resolveViewOrgId } from '../../../auth/guards.js';
import * as mappingsRepo from '../../../data/repositories/sheet-schedule-import.js';
import { applyToSchedule } from '../../../core/integrations/sheet-schedule-import.js';

const ConfirmBody = Type.Object({ employee_id: Type.Number() });
type ConfirmBody = Static<typeof ConfirmBody>;

export async function registerAdminSheetImportRoutes(app: FastifyInstance) {
  app.get('/admin/sheet-import/pending', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const q = request.query as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, q.org_id);
    const items = await mappingsRepo.listPending(orgId);
    return { items };
  });

  app.post(
    '/admin/sheet-import/pending/:id/confirm',
    { schema: { body: ConfirmBody } },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const id = Number((request.params as { id: string }).id);
      const { employee_id } = request.body as ConfirmBody;
      const pending = await mappingsRepo.findPendingById(id);
      if (!pending || pending.status !== 'pending') {
        return reply.code(404).send({ error: 'not_found' });
      }

      await mappingsRepo.createConfirmedMapping(pending.org_id, pending.sheet_name_raw, employee_id, request.user!.employee_id);
      const outcome = await applyToSchedule(employee_id, {
        storeId: pending.store_id || '',
        workDate: pending.work_date,
        shiftRaw: pending.shift_raw || ''
      });
      await mappingsRepo.resolvePending(id, 'confirmed', request.user!.employee_id);
      return { ok: true, outcome };
    }
  );

  app.post('/admin/sheet-import/pending/:id/reject', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const id = Number((request.params as { id: string }).id);
    const pending = await mappingsRepo.findPendingById(id);
    if (!pending || pending.status !== 'pending') {
      return reply.code(404).send({ error: 'not_found' });
    }
    await mappingsRepo.resolvePending(id, 'rejected', request.user!.employee_id);
    return { ok: true };
  });
}
