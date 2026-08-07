/**
 * Прогноз, точный heatmap по часу, когорты новичков, BI-экспорт.
 * Выделено из routes-v13.ts.
 */
import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import { requireAuth, requireManager, resolveViewOrgId, assertStoreInOrg } from './middleware-auth.js';
import { forecastStore, salesHeatmap, newbieCohorts, getStaffingHints } from './services/forecast.js';
import { rebuildHourProfiles } from './services/insights.js';
import { getLiveNetworkMap } from './services/live-map.js';
import { todayMoscow } from './utils/date.js';

export async function registerForecastRoutes(app: FastifyInstance) {
  app.get('/forecast/:storeId', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { storeId } = request.params as { storeId: string };
    const { org_id } = request.query as { org_id?: string };
    if (!(await assertStoreInOrg(storeId, resolveViewOrgId(request.user!, org_id)))) {
      return reply.code(403).send({ error: 'forbidden', message: 'Точка не принадлежит вашей сети' });
    }
    const from = String((request.query as any)?.from || todayMoscow()).slice(0, 10);
    const days = Math.min(Number((request.query as any)?.days) || 7, 14);
    const fc = await forecastStore(storeId, from, days);
    return { store_id: storeId, ...fc };
  });

  // «Кого куда поставить» — эвристика на основе прогноза + текущего графика,
  // не точный расчёт (абсолютной меры «нужно N человек» у нас нет).
  app.get('/staffing-hints', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { org_id } = request.query as { org_id?: string };
    const days = Math.min(Number((request.query as any)?.days) || 7, 14);
    return { items: await getStaffingHints(days, resolveViewOrgId(request.user!, org_id)) };
  });

  app.get('/heatmap/:storeId', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { storeId } = request.params as { storeId: string };
    const { org_id } = request.query as { org_id?: string };
    if (!(await assertStoreInOrg(storeId, resolveViewOrgId(request.user!, org_id)))) {
      return reply.code(403).send({ error: 'forbidden', message: 'Точка не принадлежит вашей сети' });
    }
    return salesHeatmap(storeId);
  });

  app.get('/cohorts/newbies', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { org_id } = request.query as { org_id?: string };
    return newbieCohorts(resolveViewOrgId(request.user!, org_id));
  });

  // Пересчёт почасовых профилей — обслуживающая операция над всей БД разом,
  // ничего чужого не показывает наружу, поэтому без scoping по сети.
  app.post('/admin/rebuild-hour-profiles', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    return rebuildHourProfiles();
  });

  // ========== BI EXPORT (JSON truth) ==========
  app.get('/export/bi/daily', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { org_id } = request.query as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, org_id);
    const date = String((request.query as any)?.date || todayMoscow()).slice(0, 10);
    const sales = await query(
      `SELECT s.*, e.full_name, st.name as store_name, st.code
       FROM sales s
       JOIN employees e ON e.id = s.employee_id
       JOIN stores st ON st.id = s.store_id
       WHERE s.sale_date::date = $1::date AND COALESCE(st.org_id,'default') = $2`,
      [date, orgId]
    );
    const live = await getLiveNetworkMap(orgId);
    return {
      source: 't2-sales-app',
      generated_at: new Date().toISOString(),
      date,
      sales: sales.rows,
      network: live
    };
  });
}
