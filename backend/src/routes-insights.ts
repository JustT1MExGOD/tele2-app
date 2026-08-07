/**
 * Личная аналитика сотрудника: инсайт по смене, само-сравнение, дневной
 * план по часам, завершение обучения. Выделено из routes-v13.ts.
 */
import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import { requireAuth } from './middleware-auth.js';
import { buildShiftInsight, selfComparison, splitDayPlanByHours } from './services/insights.js';
import { getGamificationProfile, addXp, grantBadge } from './services/gamification.js';
import { todayMoscow } from './utils/date.js';

function num(v: any) {
  return Number(v) || 0;
}

export async function registerInsightsRoutes(app: FastifyInstance) {
  app.get('/me/insight', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const date = String((request.query as any)?.date || todayMoscow()).slice(0, 10);
    const employee_id = request.user!.employee_id!;

    const sch = await query(
      `SELECT store_id FROM schedules
       WHERE employee_id=$1 AND work_date::date=$2::date LIMIT 1`,
      [employee_id, date]
    );
    const store_id = sch.rows[0]?.store_id;
    if (!store_id) return { message: 'Нет смены в графике', insight: null };

    const day = await query(
      // soft dependency: client can also pass day plan
      `SELECT COALESCE(SUM(sim),0) sim, COALESCE(SUM(mnp),0) mnp,
              COALESCE(SUM(pa),0) pa, COALESCE(SUM(combo),0) combo,
              COALESCE(SUM(phones),0) phones, COALESCE(SUM(accessories),0) accessories
       FROM sales WHERE employee_id=$1 AND sale_date::date=$2::date`,
      [employee_id, date]
    );
    const fact = day.rows[0] || {};

    // approximate day plan from month
    const month = date.slice(0, 7) + '-01';
    const planRow = await query(
      `SELECT * FROM employee_month_plans WHERE employee_id=$1 AND month::date=$2::date`,
      [employee_id, month]
    );
    const rem = await query(
      `SELECT COUNT(*)::int c FROM schedules
       WHERE employee_id=$1 AND work_date::date >= $2::date
         AND work_date::date < ($3::date + interval '1 month') AND COALESCE(hours,0)>0`,
      [employee_id, date, month]
    );
    const div = Math.max(1, num(rem.rows[0]?.c));
    const mp = planRow.rows[0] || {};
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

  app.get('/me/self-stats', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const stats = await selfComparison(request.user!.employee_id!);
    const gam = await getGamificationProfile(request.user!.employee_id!);
    return { ...stats, gamification: gam };
  });

  // Обучение v3 (10-tutorial.js) даёт XP+бейдж за прохождение курса.
  // Идемпотентно: повторный вызов (например, перезапуск курса вручную)
  // не начисляет XP снова — grantBadge сам по себе ON CONFLICT DO NOTHING,
  // но addXp нет, поэтому проверяем бейдж заранее.
  app.post('/me/tutorial-complete', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const employeeId = request.user!.employee_id!;
    const isManagerMode = (request.body as any)?.mode === 'manager';
    const code = isManagerMode ? 'tutorial_mgr_done' : 'tutorial_done';
    const title = isManagerMode ? 'Обучение управляющего пройдено' : 'Обучение пройдено';

    const existing = await query(
      `SELECT 1 FROM employee_badges WHERE employee_id = $1 AND badge_code = $2`,
      [employeeId, code]
    );
    if (!existing.rows.length) {
      await addXp(employeeId, 50, code);
      await grantBadge(employeeId, code, title);
    }
    return { ok: true };
  });

  app.get('/me/day-plan-split', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const date = String((request.query as any)?.date || todayMoscow()).slice(0, 10);
    const employee_id = request.user!.employee_id!;
    const sch = await query(
      `SELECT store_id FROM schedules WHERE employee_id=$1 AND work_date::date=$2::date LIMIT 1`,
      [employee_id, date]
    );
    if (!sch.rows[0]) return { error: 'no shift' };

    const month = date.slice(0, 7) + '-01';
    const planRow = await query(
      `SELECT * FROM employee_month_plans WHERE employee_id=$1 AND month::date=$2::date`,
      [employee_id, month]
    );
    const rem = await query(
      `SELECT COUNT(*)::int c FROM schedules
       WHERE employee_id=$1 AND work_date::date >= $2::date
         AND work_date::date < ($3::date + interval '1 month') AND COALESCE(hours,0)>0`,
      [employee_id, date, month]
    );
    const div = Math.max(1, num(rem.rows[0]?.c));
    const mp = planRow.rows[0] || {};
    const dayPlan: Record<string, number> = {};
    for (const m of ['sim', 'mnp', 'pa', 'combo', 'phones', 'accessories']) {
      dayPlan[m] = Math.ceil(num(mp[m]) / div);
    }
    const split = await splitDayPlanByHours({
      storeId: sch.rows[0].store_id,
      date,
      dayPlan
    });
    return { day_plan: dayPlan, split };
  });
}
