/**
 * Планы: месячные планы сотрудников, сводная таблица, дневные планы точек
 * и справочные дневные/шаблонные планы (GET /plans, слито из
 * routes-core.ts — 20.11.0, репо-реструктуризация).
 *
 * await registerPlansRoutes(app);
 */

import { FastifyInstance, FastifyReply } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { requireManager, requireAuth, requireActive, resolveViewOrgId, assertEmployeeInOrg, requireStoreInOrg, requireEmployeeInOrg } from '../../auth/guards.js';
import { record as recordAudit } from '../../data/repositories/audit.js';
import * as plansRepo from '../../data/repositories/plans.js';

// Метрики — динамический набор из METRICS (каталог), не перечисляем
// поимённо в схеме (та же логика, что PostSaleBody в routes-sales.ts) —
// additionalProperties: true, схема гарантирует только month/org_id.
const MonthPlanBody = Type.Object(
  {
    month: Type.Optional(Type.String()),
    org_id: Type.Optional(Type.String())
  },
  { additionalProperties: true }
);
type MonthPlanBody = Static<typeof MonthPlanBody>;
import {
  getMonthSummaryTable,
  getStoreMonthSummaryTable,
  upsertEmployeeMonthPlan,
  getEmployeeMonthPlan,
  getEmployeeDailyPlan,
  computeStoreDailyPlans,
  materializeStoreDailyPlans,
  getStoreMonthPlan,
  upsertStoreMonthPlan,
  METRICS,
  monthStart
} from '../../core/plans/service.js';
import { currentMonthMoscow, todayMoscow } from '../../utils/date.js';
import type {
  MonthSummaryTableResponse,
  StoreMonthSummaryTableResponse,
  EmployeeMonthPlanResponse,
  StoreDailyPlansResponse,
  StoreMonthPlanResponse
} from '../../shared/api-types.js';

export async function registerPlansRoutes(app: FastifyInstance) {
  // Справочные данные: шаблоны/дневные планы точек (см. api/routes/org/stores.ts
  // для самих точек). Слито из routes-core.ts (20.11.0).
  app.get('/plans', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const { date, org_id } = (request.query || {}) as { date?: string; org_id?: string };
    const orgId = resolveViewOrgId(request.user!, org_id);
    if (date) {
      const day = await plansRepo.findDayPlansForOrg(date, orgId);
      if (day.length) return day;
    }
    return plansRepo.findTemplatePlansForOrg(orgId);
  });

  // Сводная таблица «как Excel»: факт / план / % — по сотрудникам своей сети
  app.get('/plans/employees/month', async (request, reply): Promise<MonthSummaryTableResponse | undefined> => {
    if (!requireActive(request, reply)) return;
    const { month, org_id } = request.query as { month?: string; org_id?: string };
    const m = month || currentMonthMoscow();
    const orgId = resolveViewOrgId(request.user!, org_id);
    return getMonthSummaryTable(m, orgId);
  });

  // Та же сводная таблица, но по точкам сети, не по сотрудникам — «Динамика
  // выполнения», вторая половина под разбивкой по сотрудникам (см. frontend
  // pages/plans-bfq). Тот же гейт (requireActive, «видно всей команде»).
  app.get('/plans/stores/month', async (request, reply): Promise<StoreMonthSummaryTableResponse | undefined> => {
    if (!requireActive(request, reply)) return;
    const { month, org_id } = request.query as { month?: string; org_id?: string };
    const m = month || currentMonthMoscow();
    const orgId = resolveViewOrgId(request.user!, org_id);
    return getStoreMonthSummaryTable(m, orgId);
  });

  // План одного сотрудника на месяц. Раньше вообще без авторизации — план
  // (цели по метрикам) любого сотрудника любой сети был виден по id кому угодно.
  app.get('/plans/employees/:id/month', async (request, reply): Promise<EmployeeMonthPlanResponse | FastifyReply | undefined> => {
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
  app.put(
    '/plans/employees/:id/month',
    // Раньше без проверки — manager любой сети мог задать план сотруднику
    // вообще любой другой сети по угаданному id.
    {
      preHandler: [requireEmployeeInOrg('params', 'id', { allowOrgOverride: true })],
      schema: { body: MonthPlanBody }
    },
    async (request, reply): Promise<EmployeeMonthPlanResponse | FastifyReply | undefined> => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const month = body.month || currentMonthMoscow();
    const data: Record<string, number> = {};
    for (const m of METRICS) {
      if (body[m] !== undefined) data[m] = Number(body[m]) || 0;
    }
    const plan = await upsertEmployeeMonthPlan(Number(id), month, data);

    // 19.23.0 (Audit Trail): не в withTransaction — upsertEmployeeMonthPlan
    // сама по себе со своей веткой восстановления (INSERT..ON CONFLICT →
    // фолбэк на UPDATE/INSERT при сбое) — заворачивать
    // это в общую транзакцию с audit-записью значило бы трогать эту логику
    // отдельным неаккуратным рефакторингом ради одного роута. Ошибку
    // recordAudit не глушим (не .catch(()=>{})) — если она упадёт, ответ
    // будет 500, но сам план к этому моменту уже сохранён.
    await recordAudit({
      orgId: resolveViewOrgId(request.user!, body.org_id),
      actorEmployeeId: request.user!.employee_id,
      actorTelegramId: request.user!.telegram_id ? Number(request.user!.telegram_id) : null,
      action: 'plan.update',
      targetType: 'employee_plan',
      targetId: id,
      after: data,
      requestId: request.id,
      actorRole: request.user!.role
    });

    return plan;
    }
  );

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
  app.get('/plans/stores/daily', async (request, reply): Promise<StoreDailyPlansResponse | undefined> => {
    if (!requireActive(request, reply)) return;
    const { date, org_id } = request.query as { date?: string; org_id?: string };
    const orgId = resolveViewOrgId(request.user!, org_id);
    return computeStoreDailyPlans(date, orgId);
  });

  // План одной точки на месяц (вносится вручную, независимо от планов сотрудников)
  // Security audit (20.52.0) — этот GET не имел org-scope check вообще,
  // в отличие от PUT-сиблинга сразу ниже (уже requireStoreInOrg): любой
  // активный сотрудник любой сети мог прочитать план продаж чужой точки,
  // просто подобрав/перебрав id. Тот же preHandler, что у PUT.
  app.get(
    '/plans/stores/:id/month',
    { preHandler: [requireStoreInOrg('params', 'id', { allowOrgOverride: true })] },
    async (request, reply): Promise<StoreMonthPlanResponse | FastifyReply | undefined> => {
    if (!requireActive(request, reply)) return;
    const { id } = request.params as { id: string };
    const { month } = request.query as { month?: string };
    const m = month || currentMonthMoscow();
    const plan = await getStoreMonthPlan(id, m);
    return plan || { store_id: id, month: monthStart(m), empty: true };
    }
  );

  // Manager: задать / обновить месячный план точки (только своей сети)
  app.put(
    '/plans/stores/:id/month',
    {
      preHandler: [requireStoreInOrg('params', 'id', { allowOrgOverride: true })],
      schema: { body: MonthPlanBody }
    },
    async (request, reply): Promise<StoreMonthPlanResponse | FastifyReply | undefined> => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = request.body as any;
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

    // 19.23.0 (Audit Trail) — та же логика, что у плана сотрудника выше:
    // best-effort по transaction wrapping (upsertStoreMonthPlan простая, но
    // после неё уже идёт материализация store_plans — общую транзакцию на
    // всё это не строим), ошибку recordAudit не глушим.
    await recordAudit({
      orgId: resolveViewOrgId(request.user!, body.org_id),
      actorEmployeeId: request.user!.employee_id,
      actorTelegramId: request.user!.telegram_id ? Number(request.user!.telegram_id) : null,
      action: 'plan.update',
      targetType: 'store_plan',
      targetId: id,
      after: data,
      requestId: request.id,
      actorRole: request.user!.role
    });

    return plan;
    }
  );
}
