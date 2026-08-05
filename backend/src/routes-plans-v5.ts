/**
 * v5: месячные планы сотрудников, сводная таблица, дневные планы точек
 *
 * await registerPlansV5Routes(app);
 */

import { FastifyInstance } from 'fastify';
import { requireManager, requireAuth, requireActive, resolveViewOrgId } from './middleware-auth.js';
import {
  getMonthSummaryTable,
  upsertEmployeeMonthPlan,
  getEmployeeMonthPlan,
  getEmployeeDailyPlan,
  computeStoreDailyPlans,
  materializeStoreDailyPlans,
  METRICS,
  monthStart
} from './services/plans.js';
import { currentMonthMoscow, todayMoscow } from './utils/date.js';

export async function registerPlansV5Routes(app: FastifyInstance) {
  // Сводная таблица «как Excel»: факт / план / % — по сотрудникам своей сети
  app.get('/plans/employees/month', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const { month, org_id } = request.query as { month?: string; org_id?: string };
    const m = month || currentMonthMoscow();
    const orgId = resolveViewOrgId(request.user!, org_id);
    return getMonthSummaryTable(m, orgId);
  });

  // План одного сотрудника на месяц
  app.get('/plans/employees/:id/month', async (request) => {
    const { id } = request.params as { id: string };
    const { month } = request.query as { month?: string };
    const m = month || currentMonthMoscow();
    const plan = await getEmployeeMonthPlan(Number(id), m);
    return plan || { employee_id: Number(id), month: monthStart(m), empty: true };
  });

  // Manager: задать / обновить месячный план сотрудника
  app.put('/plans/employees/:id/month', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const month = body.month || currentMonthMoscow();
    const data: Record<string, number> = {};
    for (const m of METRICS) {
      if (body[m] !== undefined) data[m] = Number(body[m]) || 0;
    }
    return upsertEmployeeMonthPlan(Number(id), month, data);
  });

  // Дневной план сотрудника (остаток / оставшиеся смены)
  app.get('/plans/employees/:id/daily', async (request) => {
    const { id } = request.params as { id: string };
    const { date } = request.query as { date?: string };
    return getEmployeeDailyPlan(Number(id), date || todayMoscow());
  });

  // Вычисленные дневные планы точек своей сети (доли — stores.plan_share)
  app.get('/plans/stores/daily', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const { date, org_id } = request.query as { date?: string; org_id?: string };
    const orgId = resolveViewOrgId(request.user!, org_id);
    return computeStoreDailyPlans(date, orgId);
  });

  // Записать дневные планы точек в БД на дату
  app.post('/plans/stores/daily/materialize', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const body = (request.body as any) || {};
    return materializeStoreDailyPlans(body.date);
  });
}
