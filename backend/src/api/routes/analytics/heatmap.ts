/**
 * Точный почасовой heatmap продаж. Выделено из routes-v14.ts (20.11.0,
 * репо-реструктуризация) — брендинг/сети уехали в org/branding.ts.
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { requireActive, requireStoreInOrg } from '../../../auth/guards.js';
import { salesHeatmap } from '../../../core/analytics/heatmap.js';
import { serverError } from '../../../shared/errors.js';
import type { HeatmapPreciseResponse } from '../../../shared/api-types.js';

export async function registerHeatmapRoutes(app: FastifyInstance) {
  app.get(
    '/heatmap/precise/:storeId',
    { preHandler: [requireStoreInOrg('params', 'storeId', { allowOrgOverride: true })] },
    async (request, reply): Promise<HeatmapPreciseResponse | FastifyReply | undefined> => {
    if (!requireActive(request, reply)) return;
    const storeId = (request.params as any).storeId;
    const weeks = Math.min(Number((request.query as any)?.weeks) || 4, 12);
    try {
      return await salesHeatmap(storeId, weeks);
    } catch (e: any) {
      return serverError(request, reply, 'heatmap_failed', e);
    }
    }
  );
  // POST /admin/rebuild-hour-profiles — уже в api/routes/analytics/forecast.ts, не дублировать
}
