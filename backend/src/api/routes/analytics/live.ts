/**
 * Живая карта сети. Выделено из routes-live-alerts.ts (20.11.0,
 * репо-реструктуризация) — алерты уехали в ops/alerts.ts, what-if — в
 * analytics/what-if.ts.
 */
import { FastifyInstance } from 'fastify';
import { requireAuth, resolveViewOrgId } from '../../../auth/guards.js';
import { getLiveNetworkMap } from '../../../core/analytics/live-map.js';
import type { NetworkLiveResponse } from '../../../shared/api-types.js';

export async function registerLiveMapRoutes(app: FastifyInstance) {
  app.get('/network/live', async (request, reply): Promise<NetworkLiveResponse | undefined> => {
    if (!requireAuth(request, reply)) return;
    const { org_id } = request.query as { org_id?: string };
    return getLiveNetworkMap(resolveViewOrgId(request.user!, org_id));
  });
}
