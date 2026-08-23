/**
 * Личная аналитика сотрудника: инсайт по смене, само-сравнение, дневной
 * план по часам, завершение обучения. Выделено из routes-v13.ts.
 */
import { FastifyInstance } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { requireAuth } from '../../../auth/guards.js';
import { buildShiftInsight, selfComparison, splitDayPlanByHours } from '../../../core/analytics/insights.js';
import { getGamificationProfile, addXp, grantBadge } from '../../../core/employees/gamification.js';
import { todayMoscow } from '../../../utils/date.js';
import * as schedulesRepo from '../../../data/repositories/schedules.js';
import * as salesRepo from '../../../data/repositories/sales.js';
import * as plansRepo from '../../../data/repositories/plans.js';
import * as gamificationRepo from '../../../data/repositories/gamification.js';
import type { MyInsightResponse, SelfStatsResponse } from '../../../shared/api-types.js';

const TutorialCompleteBody = Type.Object({
  mode: Type.Optional(Type.String())
});
type TutorialCompleteBody = Static<typeof TutorialCompleteBody>;

function num(v: any) {
  return Number(v) || 0;
}

export async function registerInsightsRoutes(app: FastifyInstance) {
  app.get('/me/insight', async (request, reply): Promise<MyInsightResponse | undefined> => {
    if (!requireAuth(request, reply)) return;
    const date = String((request.query as any)?.date || todayMoscow()).slice(0, 10);
    const employee_id = request.user!.employee_id!;

    const store_id = await schedulesRepo.findShiftStoreIdForDate(employee_id, date);
    if (!store_id) return { message: 'Нет смены в графике', insight: null };

    // soft dependency: client can also pass day plan
    const fact = await salesRepo.sumDayFactNarrow(employee_id, date);

    // approximate day plan from month
    const month = date.slice(0, 7) + '-01';
    const mp = (await plansRepo.findEmployeeMonthPlanExact(employee_id, month)) || {};
    const remCnt = await schedulesRepo.countRemainingInMonth(employee_id, date, month);
    const div = Math.max(1, num(remCnt));
    const dayPlan: Record<string, number> = {};
    for (const m of ['sim', 'mnp', 'pa', 'combo', 'phones', 'accessories']) {
      dayPlan[m] = Math.ceil(num(mp[m]) / div);
    }

    const insight = await buildShiftInsight({
      employeeId: employee_id,
      storeId: store_id,
      date,
      fact,
      dayPlan
    });
    return { store_id, fact, day_plan: dayPlan, insight };
  });

  app.get('/me/self-stats', async (request, reply): Promise<SelfStatsResponse | undefined> => {
    if (!requireAuth(request, reply)) return;
    const stats = await selfComparison(request.user!.employee_id!);
    const gam = await getGamificationProfile(request.user!.employee_id!);
    return { ...stats, gamification: gam };
  });

  // Обучение v3 (10-tutorial.js) даёт XP+бейдж за прохождение курса.
  // Идемпотентно: повторный вызов (например, перезапуск курса вручную)
  // не начисляет XP снова — grantBadge сам по себе ON CONFLICT DO NOTHING,
  // но addXp нет, поэтому проверяем бейдж заранее.
  app.post(
    '/me/tutorial-complete',
    { schema: { body: TutorialCompleteBody } },
    async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const employeeId = request.user!.employee_id!;
    const isManagerMode = (request.body as TutorialCompleteBody)?.mode === 'manager';
    const code = isManagerMode ? 'tutorial_mgr_done' : 'tutorial_done';
    const title = isManagerMode ? 'Обучение управляющего пройдено' : 'Обучение пройдено';

    const already = await gamificationRepo.hasBadge(employeeId, code);
    if (!already) {
      await addXp(employeeId, 50, code);
      await grantBadge(employeeId, code, title);
    }
    return { ok: true };
    }
  );

  app.get('/me/day-plan-split', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const date = String((request.query as any)?.date || todayMoscow()).slice(0, 10);
    const employee_id = request.user!.employee_id!;
    const storeId = await schedulesRepo.findShiftStoreIdForDate(employee_id, date);
    if (!storeId) return { error: 'no shift' };

    const month = date.slice(0, 7) + '-01';
    const mp = (await plansRepo.findEmployeeMonthPlanExact(employee_id, month)) || {};
    const remCnt = await schedulesRepo.countRemainingInMonth(employee_id, date, month);
    const div = Math.max(1, num(remCnt));
    const dayPlan: Record<string, number> = {};
    for (const m of ['sim', 'mnp', 'pa', 'combo', 'phones', 'accessories']) {
      dayPlan[m] = Math.ceil(num(mp[m]) / div);
    }
    const split = await splitDayPlanByHours({
      storeId,
      date,
      dayPlan
    });
    return { day_plan: dayPlan, split };
  });
}
