/**
 * BFQ (комплексный показатель качества/прибыли сотрудника): расчёт по
 * сети/сотруднику, ручной VMR+штраф, анкета VMR. Выделено из routes-v3.ts.
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import * as bfqRepo from '../../data/repositories/bfq.js';
import {
  calculateAllBFQ,
  calculateEmployeeBFQ,
  upsertBFQManual,
  addVMRQuestionnaire
} from '../../core/bfq/service.js';
import { requireActive, requireManager, resolveViewOrgId, assertEmployeeInOrg, requireEmployeeInOrg } from '../../auth/guards.js';
import { currentMonthMoscow } from '../../utils/date.js';
import type { BfqListResponse, BfqEmployeeResponse } from '../../shared/api-types.js';

const BFQManualBody = Type.Object({
  employee_id: Type.Number(),
  month: Type.Optional(Type.String()),
  vmr_avg: Type.Optional(Type.Number()),
  penalty: Type.Optional(Type.Number()),
  org_id: Type.Optional(Type.String())
});
type BFQManualBody = Static<typeof BFQManualBody>;

const BFQQuestionnaireBody = Type.Object({
  employee_id: Type.Number(),
  score: Type.Number(),
  comment: Type.Optional(Type.String()),
  org_id: Type.Optional(Type.String())
});
type BFQQuestionnaireBody = Static<typeof BFQQuestionnaireBody>;

export async function registerBfqRoutes(app: FastifyInstance) {
  // Раньше оба GET были вообще без авторизации — кто угодно без токена мог
  // узнать BFQ (качество/прибыль) любого сотрудника любой сети по id.
  app.get('/bfq', async (request, reply): Promise<BfqListResponse | undefined> => {
    if (!requireActive(request, reply)) return;
    const { month, org_id } = request.query as { month?: string; org_id?: string };
    const m = month || currentMonthMoscow();
    const orgId = resolveViewOrgId(request.user!, org_id);
    const items = await calculateAllBFQ(m, orgId);
    return { month: m, items };
  });

  app.get('/bfq/:employeeId', async (request, reply): Promise<BfqEmployeeResponse | FastifyReply | undefined> => {
    if (!requireActive(request, reply)) return;
    const { employeeId } = request.params as { employeeId: string };
    const { month, org_id } = request.query as { month?: string; org_id?: string };
    const m = month || currentMonthMoscow();
    const id = Number(employeeId);
    // Свой показатель — всегда; чужой — только если сотрудник твоей сети
    // (или сети, явно выбранной admin-переключателем).
    if (id !== request.user!.employee_id) {
      const orgId = resolveViewOrgId(request.user!, org_id);
      if (!(await assertEmployeeInOrg(id, orgId))) {
        return reply.code(403).send({ error: 'forbidden', message: 'Сотрудник не принадлежит вашей сети' });
      }
    }
    return calculateEmployeeBFQ(id, m);
  });

  // VMR + штраф (manager)
  app.post(
    '/bfq/manual',
    {
      preHandler: [requireEmployeeInOrg('body', 'employee_id', { allowOrgOverride: true })],
      schema: { body: BFQManualBody }
    },
    async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const body = request.body as BFQManualBody;
    const employee_id = Number(body.employee_id);
    const month = String(body.month || currentMonthMoscow());
    const vmr_avg = Number(body.vmr_avg) || 0;
    const penalty = Number(body.penalty) || 0;
    if (!employee_id) return reply.code(400).send({ error: 'employee_id required' });
    return upsertBFQManual(employee_id, month, vmr_avg, penalty);
    }
  );

  // Анкета VMR
  app.post(
    '/bfq/questionnaire',
    {
      preHandler: [requireEmployeeInOrg('body', 'employee_id', { allowOrgOverride: true })],
      schema: { body: BFQQuestionnaireBody }
    },
    async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const body = request.body as BFQQuestionnaireBody;
    const employee_id = Number(body.employee_id);
    const score = Number(body.score);
    const comment = String(body.comment || '');
    if (!employee_id || !score) {
      return reply.code(400).send({ error: 'employee_id and score required' });
    }
    return addVMRQuestionnaire(employee_id, score, comment);
    }
  );

  app.get('/bfq/questionnaires', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { employee_id, month, org_id } = request.query as { employee_id?: string; month?: string; org_id?: string };
    const m = month || currentMonthMoscow();
    const start = `${m}-01`;
    const orgId = resolveViewOrgId(request.user!, org_id);
    return bfqRepo.listQuestionnaires(start, orgId, employee_id ? Number(employee_id) : null);
  });
}
