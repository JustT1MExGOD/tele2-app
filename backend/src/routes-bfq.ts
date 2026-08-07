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
import { requireManager } from './middleware-auth.js';
import { currentMonthMoscow } from './utils/date.js';

export async function registerBfqRoutes(app: FastifyInstance) {
  app.get('/bfq', async (request) => {
    const { month } = request.query as { month?: string };
    const m = month || currentMonthMoscow();
    const items = await calculateAllBFQ(m);
    return { month: m, items };
  });

  app.get('/bfq/:employeeId', async (request) => {
    const { employeeId } = request.params as { employeeId: string };
    const { month } = request.query as { month?: string };
    const m = month || currentMonthMoscow();
    return calculateEmployeeBFQ(Number(employeeId), m);
  });

  // VMR + штраф (manager)
  app.post('/bfq/manual', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const body = request.body as any;
    const employee_id = Number(body.employee_id);
    const month = String(body.month || currentMonthMoscow());
    const vmr_avg = Number(body.vmr_avg) || 0;
    const penalty = Number(body.penalty) || 0;
    if (!employee_id) return reply.code(400).send({ error: 'employee_id required' });
    return upsertBFQManual(employee_id, month, vmr_avg, penalty);
  });

  // Анкета VMR
  app.post('/bfq/questionnaire', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const body = request.body as any;
    const employee_id = Number(body.employee_id);
    const score = Number(body.score);
    const comment = String(body.comment || '');
    if (!employee_id || !score) {
      return reply.code(400).send({ error: 'employee_id and score required' });
    }
    return addVMRQuestionnaire(employee_id, score, comment);
  });

  app.get('/bfq/questionnaires', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { employee_id, month } = request.query as { employee_id?: string; month?: string };
    const m = month || currentMonthMoscow();
    const start = `${m}-01`;
    const params: any[] = [start];
    let sql = `
      SELECT q.*, e.full_name
      FROM bfq_questionnaires q
      JOIN employees e ON e.id = q.employee_id
      WHERE q.created_at >= $1::date
    `;
    if (employee_id) {
      params.push(Number(employee_id));
      sql += ` AND q.employee_id = $2`;
    }
    sql += ` ORDER BY q.created_at DESC LIMIT 200`;
    const res = await query(sql, params);
    return res.rows;
  });
}
