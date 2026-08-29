/**
 * Живая карта сети. Выделено из routes-live-alerts.ts (20.11.0,
 * репо-реструктуризация) — алерты уехали в ops/alerts.ts, what-if — в
 * analytics/what-if.ts.
 */
import { FastifyInstance } from 'fastify';
import { requireActive, resolveViewOrgId } from '../../../auth/guards.js';
import { getLiveNetworkMap } from '../../../core/analytics/live-map.js';
import type { NetworkLiveResponse } from '../../../shared/api-types.js';

export async function registerLiveMapRoutes(app: FastifyInstance) {
  app.get(
    '/network/live',
    // 20.50.0 — getLiveNetworkMap() делает 5 последовательных запросов НА
    // КАЖДУЮ точку сети (core/analytics/live-map.ts), раньше без лимита.
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply): Promise<NetworkLiveResponse | undefined> => {
    if (!requireActive(request, reply)) return;
    const { org_id } = request.query as { org_id?: string };
    return getLiveNetworkMap(resolveViewOrgId(request.user!, org_id));
    }
  );
}
