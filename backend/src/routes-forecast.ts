/**
 * Прогноз, точный heatmap по часу, когорты новичков, BI-экспорт.
 * Выделено из routes-v13.ts.
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { requireAuth, requireManager, resolveViewOrgId, requireStoreInOrg } from './middleware-auth.js';
import { forecastStore, salesHeatmap, newbieCohorts, getStaffingHints } from './services/forecast.js';
import { rebuildHourProfiles } from './services/insights.js';
import { getLiveNetworkMap } from './services/live-map.js';
import { generateForecastSummary, getLatestForecastSummary } from './services/ai.js';
import { todayMoscow } from './utils/date.js';
import * as storesRepo from './repositories/stores.js';
import * as salesRepo from './repositories/sales.js';
import type { ForecastResponse, StaffingHintsResponse } from './shared/api-types.js';

export async function registerForecastRoutes(app: FastifyInstance) {
  app.get(
    '/forecast/:storeId',
    { preHandler: [requireStoreInOrg('params', 'storeId', { allowOrgOverride: true })] },
    async (request, reply): Promise<ForecastResponse | FastifyReply | undefined> => {
    if (!requireAuth(request, reply)) return;
    const { storeId } = request.params as { storeId: string };
    const from = String((request.query as any)?.from || todayMoscow()).slice(0, 10);
    const days = Math.min(Number((request.query as any)?.days) || 7, 14);
    const fc = await forecastStore(storeId, from, days);

    // AI только объясняет уже посчитанный прогноз словами, раз в день на
    // точку (кэш в ai_audit) — не дёргает Groq при каждом открытии страницы.
    let aiSummary = await getLatestForecastSummary(storeId, from);
    if (!aiSummary && fc.history_days >= 7) {
      const storeName = await storesRepo.findDisplayName(storeId);
      aiSummary = await generateForecastSummary({
        storeId,
        storeName: storeName || storeId,
        date: from,
        items: fc.items
      });
    }

    return { store_id: storeId, ...fc, ai_summary: aiSummary };
    }
  );

  // «Кого куда поставить» — эвристика на основе прогноза + текущего графика,
  // не точный расчёт (абсолютной меры «нужно N человек» у нас нет).
  app.get('/staffing-hints', async (request, reply): Promise<StaffingHintsResponse | undefined> => {
    if (!requireManager(request, reply)) return;
    const { org_id } = request.query as { org_id?: string };
    const days = Math.min(Number((request.query as any)?.days) || 7, 14);
    return { items: await getStaffingHints(days, resolveViewOrgId(request.user!, org_id)) };
  });

  app.get(
    '/heatmap/:storeId',
    { preHandler: [requireStoreInOrg('params', 'storeId', { allowOrgOverride: true })] },
    async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { storeId } = request.params as { storeId: string };
    return salesHeatmap(storeId);
    }
  );

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
    const sales = await salesRepo.findForBiDaily(date, orgId);
    const live = await getLiveNetworkMap(orgId);
    return {
      source: 't2-sales-app',
      generated_at: new Date().toISOString(),
      date,
      sales,
      network: live
    };
  });
}
