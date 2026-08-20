/**
 * BFQ (комплексный показатель качества/прибыли сотрудника): расчёт по
 * сети/сотруднику, ручной VMR+штраф, анкета VMR. Выделено из routes-v3.ts.
 */
import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import {
  calculateAllBFQ,
  calculateEmployeeBFQ,
  upsertBFQManual,
  addVMRQuestionnaire
} from './services/bfq.js';
import { requireActive, requireManager, resolveViewOrgId, assertEmployeeInOrg, requireEmployeeInOrg } from './middleware-auth.js';
import { currentMonthMoscow } from './utils/date.js';

export async function registerBfqRoutes(app: FastifyInstance) {
  // Раньше оба GET были вообще без авторизации — кто угодно без токена мог
  // узнать BFQ (качество/прибыль) любого сотрудника любой сети по id.
  app.get('/bfq', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const { month, org_id } = request.query as { month?: string; org_id?: string };
    const m = month || currentMonthMoscow();
    const orgId = resolveViewOrgId(request.user!, org_id);
    const items = await calculateAllBFQ(m, orgId);
    return { month: m, items };
  });

  app.get('/bfq/:employeeId', async (request, reply) => {
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
    { preHandler: [requireEmployeeInOrg('body', 'employee_id', { allowOrgOverride: true })] },
    async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const body = request.body as any;
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
    { preHandler: [requireEmployeeInOrg('body', 'employee_id', { allowOrgOverride: true })] },
    async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const body = request.body as any;
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
    const params: any[] = [start, orgId];
    let sql = `
      SELECT q.*, e.full_name
      FROM bfq_questionnaires q
      JOIN employees e ON e.id = q.employee_id
      WHERE q.created_at >= $1::date AND COALESCE(e.org_id,'default') = $2
    `;
    if (employee_id) {
      params.push(Number(employee_id));
      sql += ` AND q.employee_id = $${params.length}`;
    }
    sql += ` ORDER BY q.created_at DESC LIMIT 200`;
    const res = await query(sql, params);
    return res.rows;
  });
}
