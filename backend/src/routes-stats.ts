/**
 * Статистика по точкам, дэшборд-лидерборд, персональный прогресс.
 * Вынесено из index.ts при разбиении монолита на модули.
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { query } from './db/index.js';
import { todayMoscow } from './utils/date.js';
import { requireActive, resolveViewOrgId } from './middleware-auth.js';
import { getSalesSumColumns } from './services/metrics-catalog.js';
import type { StatsDailyResponse, DashboardResponse, EmployeeProgressResponse } from './shared/api-types.js';

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

    const res = await query(
      `SELECT
         st.id as store_id,
         COALESCE(st.display_name, st.name) as name,
         st.code,
         ${sumSelect}
       FROM stores st
       LEFT JOIN sales s ON s.store_id = st.id AND s.sale_date = $1
       WHERE COALESCE(st.org_id, 'default') = $2
       GROUP BY st.id, st.name, st.display_name, st.code, st.hours
       ORDER BY st.hours`,
      [d, orgId]
    );
    return res.rows;
  });

  // «Топ за 7 дней» — активность на точках своей сети (не по «домашней»
  // сети сотрудника — подмена в чужой сети должна засчитываться той сети,
  // где реально стоит точка, как и везде в эпике 17.0).
  app.get('/dashboard', async (request, reply): Promise<DashboardResponse | undefined> => {
    if (!requireActive(request, reply)) return;
    const { org_id } = request.query as { org_id?: string };
    const today = todayMoscow();
    const orgId = resolveViewOrgId(request.user!, org_id);
    const res = await query(
      `SELECT e.id as employee_id, e.full_name,
              COALESCE(SUM(s.sim),0)::int as sim,
              COALESCE(SUM(s.mnp),0)::int as mnp,
              COALESCE(SUM(s.pa),0)::int as pa,
              COALESCE(SUM(s.combo),0)::int as combo,
              COALESCE(SUM(s.phones),0)::float as phones,
              COALESCE(SUM(s.accessories),0)::float as accessories,
              (COALESCE(SUM(s.sim),0) + COALESCE(SUM(s.mnp),0)*2 + COALESCE(SUM(s.pa),0)*3)::int as score
       FROM sales s
       JOIN employees e ON e.id = s.employee_id
       JOIN stores st ON st.id = s.store_id
       WHERE s.sale_date::date >= ($1::date - interval '6 days')
         AND s.sale_date::date <= $1::date
         AND COALESCE(st.org_id, 'default') = $2
       GROUP BY e.id, e.full_name
       ORDER BY score DESC, sim DESC
       LIMIT 10`,
      [today, orgId]
    );
    return {
      top: res.rows,
      top7: res.rows,
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

    const sch = await query(
      `SELECT store_id FROM schedules WHERE employee_id = $1 AND work_date = $2 LIMIT 1`,
      [id, d]
    );
    const storeId = sch.rows[0]?.store_id;

    let plan: any = {};
    if (storeId) {
      const planRes = await query(
        `SELECT * FROM store_plans WHERE store_id = $1 AND plan_date IS NULL`,
        [storeId]
      );
      plan = planRes.rows[0] || {};
    }

    // Все метрики (не только "витринные" 5) — чтобы кастомные метрики были
    // видны в ответе, даже если в общий процент прогресса не идут.
    const allCols = await getSalesSumColumns();
    const factRes = await query(
      `SELECT ${allCols.map((c) => `COALESCE(SUM(${c}),0) as ${c}`).join(', ')}
       FROM sales WHERE employee_id = $1 AND sale_date = $2`,
      [id, d]
    );
    const fact = factRes.rows[0] || {};

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
