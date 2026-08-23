/**
 * Статистика по точкам, дэшборд-лидерборд, персональный прогресс.
 * Вынесено из index.ts при разбиении монолита на модули.
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { todayMoscow } from '../../../utils/date.js';
import { requireActive, resolveViewOrgId } from '../../../auth/guards.js';
import { getSalesSumColumns } from '../../../core/shared/metrics-catalog.js';
import * as repo from '../../../data/repositories/stats.js';
import type { StatsDailyResponse, DashboardResponse, EmployeeProgressResponse } from '../../../shared/api-types.js';

export async function registerStatsRoutes(app: FastifyInstance) {
  // «Сеть сегодня» — точки своей сети, не все сети вперемешку.
  app.get('/stats/daily', async (request, reply): Promise<StatsDailyResponse | undefined> => {
    if (!requireActive(request, reply)) return;
    const { date, org_id } = request.query as { date?: string; org_id?: string };
    const d = date || todayMoscow();
    const orgId = resolveViewOrgId(request.user!, org_id);

    // Динамический список метрик — иначе кастомные метрики (заведённые
    // через POST /metrics или добавленные вручную колонки типа import/esim)
    // молча пропадали бы из отчёта.
    const cols = await getSalesSumColumns();
    const sumSelect = cols.map((c) => `COALESCE(SUM(s.${c}),0) as ${c}`).join(', ');

    return repo.findDailyStoreStats(d, orgId, sumSelect);
  });

  // «Топ за 7 дней» — активность на точках своей сети (не по «домашней»
  // сети сотрудника — подмена в чужой сети должна засчитываться той сети,
  // где реально стоит точка, как и везде в эпике 17.0).
  app.get('/dashboard', async (request, reply): Promise<DashboardResponse | undefined> => {
    if (!requireActive(request, reply)) return;
    const { org_id } = request.query as { org_id?: string };
    const today = todayMoscow();
    const orgId = resolveViewOrgId(request.user!, org_id);
    const rows = await repo.findWeeklyLeaderboard(today, orgId);
    return {
      top: rows,
      top7: rows,
      period: { from: null, to: today }
    };
  });

  // ===== EMPLOYEE PROGRESS =====
  app.get('/employee/progress/:id', async (request, reply): Promise<EmployeeProgressResponse | FastifyReply | undefined> => {
    if (!requireActive(request, reply)) return;
    const { id } = request.params as { id: string };
    const isManagerRole = request.user!.role === 'manager' || request.user!.role === 'admin';
    if (!isManagerRole && String(request.user!.employee_id) !== String(id)) {
      return reply.code(403).send({ error: 'forbidden', message: 'Можно смотреть только свой прогресс' });
    }
    const { date } = request.query as { date?: string };
    const d = date || todayMoscow();

    const storeId = await repo.findShiftStoreId(id, d);

    let plan: any = {};
    if (storeId) {
      plan = await repo.findStoreTemplatePlan(storeId);
    }

    // Все метрики (не только "витринные" 5) — чтобы кастомные метрики были
    // видны в ответе, даже если в общий процент прогресса не идут.
    const allCols = await getSalesSumColumns();
    const fact = await repo.sumEmployeeDayFact(id, d, allCols.map((c) => `COALESCE(SUM(${c}),0) as ${c}`).join(', '));

    // Основной прогресс-ринг считается по ключевым метрикам (как и раньше);
    // остальные метрики попадают в result как есть, без учёта в total.
    const primaryKeys = ['sim', 'mnp', 'pa', 'combo', 'phones'] as const;
    const result: any = {};
    let totalFact = 0;
    let totalPlan = 0;

    for (const k of allCols) {
      const f = Number(fact[k]) || 0;
      const p = Number(plan[k]) || 0;
      result[k] = { fact: f, plan: p };
      if ((primaryKeys as readonly string[]).includes(k)) {
        totalFact += f;
        totalPlan += p;
      }
    }

    result.total = {
      fact: totalFact,
      plan: totalPlan,
      percent: totalPlan > 0 ? Math.round((totalFact / totalPlan) * 100) : 0,
    };

    return result;
  });
}
