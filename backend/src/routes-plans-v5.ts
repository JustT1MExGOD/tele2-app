/**
 * v5: месячные планы сотрудников, сводная таблица, дневные планы точек
 *
 * await registerPlansV5Routes(app);
 */

import { FastifyInstance } from 'fastify';
import { requireManager, requireAuth, requireActive, resolveViewOrgId, assertStoreInOrg, assertEmployeeInOrg } from './middleware-auth.js';
import {
  getMonthSummaryTable,
  upsertEmployeeMonthPlan,
  getEmployeeMonthPlan,
  getEmployeeDailyPlan,
  computeStoreDailyPlans,
  materializeStoreDailyPlans,
  getStoreMonthPlan,
  upsertStoreMonthPlan,
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

  // План одного сотрудника на месяц. Раньше вообще без авторизации — план
  // (цели по метрикам) любого сотрудника любой сети был виден по id кому угодно.
  app.get('/plans/employees/:id/month', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const { id } = request.params as { id: string };
    const { month, org_id } = request.query as { month?: string; org_id?: string };
    const empId = Number(id);
    if (empId !== request.user!.employee_id) {
      const orgId = resolveViewOrgId(request.user!, org_id);
      if (!(await assertEmployeeInOrg(empId, orgId))) {
        return reply.code(403).send({ error: 'forbidden', message: 'Сотрудник не принадлежит вашей сети' });
      }
    }
    const m = month || currentMonthMoscow();
    const plan = await getEmployeeMonthPlan(empId, m);
    return plan || { employee_id: empId, month: monthStart(m), empty: true };
  });

  // Manager: задать / обновить месячный план сотрудника
  app.put('/plans/employees/:id/month', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = request.body as any;
    // Раньше без проверки — manager любой сети мог задать план сотруднику
    // вообще любой другой сети по угаданному id.
    const orgId = resolveViewOrgId(request.user!, body.org_id);
    if (!(await assertEmployeeInOrg(Number(id), orgId))) {
      return reply.code(403).send({ error: 'forbidden', message: 'Сотрудник не принадлежит вашей сети' });
    }
    const month = body.month || currentMonthMoscow();
    const data: Record<string, number> = {};
    for (const m of METRICS) {
      if (body[m] !== undefined) data[m] = Number(body[m]) || 0;
    }
    return upsertEmployeeMonthPlan(Number(id), month, data);
  });

  // Дневной план сотрудника (остаток / оставшиеся смены)
  // Раньше вообще без авторизации (в отличие от /month-соседа выше) — план+
  // факт дня любого сотрудника любой сети был виден по id кому угодно.
  app.get('/plans/employees/:id/daily', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const { id } = request.params as { id: string };
    const { date, org_id } = request.query as { date?: string; org_id?: string };
    const empId = Number(id);
    if (empId !== request.user!.employee_id) {
      const orgId = resolveViewOrgId(request.user!, org_id);
      if (!(await assertEmployeeInOrg(empId, orgId))) {
        return reply.code(403).send({ error: 'forbidden', message: 'Сотрудник не принадлежит вашей сети' });
      }
    }
    return getEmployeeDailyPlan(empId, date || todayMoscow());
  });

  // Вычисленные дневные планы точек своей сети (остаток месячного плана точки / дни)
  app.get('/plans/stores/daily', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const { date, org_id } = request.query as { date?: string; org_id?: string };
    const orgId = resolveViewOrgId(request.user!, org_id);
    return computeStoreDailyPlans(date, orgId);
  });

  // План одной точки на месяц (вносится вручную, независимо от планов сотрудников)
  app.get('/plans/stores/:id/month', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const { id } = request.params as { id: string };
    const { month } = request.query as { month?: string };
    const m = month || currentMonthMoscow();
    const plan = await getStoreMonthPlan(id, m);
    return plan || { store_id: id, month: monthStart(m), empty: true };
  });

  // Manager: задать / обновить месячный план точки (только своей сети)
  app.put('/plans/stores/:id/month', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = (request.body as any) || {};
    const orgId = resolveViewOrgId(request.user!, body.org_id);
    if (!(await assertStoreInOrg(id, orgId))) {
      return reply.code(403).send({ error: 'forbidden', message: 'Точка не принадлежит вашей сети' });
    }
    const month = body.month || currentMonthMoscow();
    const data: Record<string, number> = {};
    for (const m of METRICS) {
      if (body[m] !== undefined) data[m] = Number(body[m]) || 0;
    }
    const plan = await upsertStoreMonthPlan(id, month, data);

    // store_plans (снапшот на сегодня/завтра, откуда реально читают BFQ,
    // live-map, дашборд, отчёты, supervisor-analytics) материализуется
    // только кроном в 6:00 МСК — без этого правка плана точки среди дня
    // была бы не видна нигде, кроме GET /plans/stores/daily (он единственный
    // считает живьём из store_month_plans), вплоть до завтрашнего утра.
    // Пересчитываем сразу теми же двумя днями, что кроном каждое утро.
    try {
      const today = todayMoscow();
      const tomorrow = new Date(today + 'T12:00:00');
      tomorrow.setDate(tomorrow.getDate() + 1);
      await materializeStoreDailyPlans(today);
      await materializeStoreDailyPlans(tomorrow.toISOString().slice(0, 10));
    } catch (e: any) {
      console.error('re-materialize after store plan edit failed:', e?.message || e);
    }

    return plan;
  });
}
