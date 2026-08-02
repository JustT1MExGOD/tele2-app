/**
 * Кабинет супервайзера
 */
import { FastifyInstance } from 'fastify';
import { authPlugin, requireAuth } from './middleware-auth.js';
import {
  resolveSupervisorStores,
  buildSupervisorDashboard
} from './services/supervisor-analytics.js';
import { todayMoscow } from './utils/date.js';

function canViewSupervisor(user: { role: string } | null | undefined) {
  if (!user) return false;
  return ['supervisor', 'manager', 'admin'].includes(user.role);
}

export async function registerSupervisorRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authPlugin);

  app.get('/supervisor/dashboard', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!canViewSupervisor(request.user)) {
      return reply.code(403).send({ error: 'forbidden', message: 'Только supervisor / manager / admin' });
    }
    const q = (request.query || {}) as { date?: string; days?: string };
    const scope = await resolveSupervisorStores(
      request.user!.employee_id,
      request.user!.role
    );
    try {
      return await buildSupervisorDashboard({
        scope,
        date: q.date || todayMoscow(),
        days: Number(q.days) || 14
      });
    } catch (e: any) {
      request.log.error(e);
      return reply.code(500).send({ error: 'dashboard_failed', message: e?.message || String(e) });
    }
  });

  app.get('/supervisor/health', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!canViewSupervisor(request.user)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const scope = await resolveSupervisorStores(
      request.user!.employee_id,
      request.user!.role
    );
    const dash = await buildSupervisorDashboard({ scope, days: 7 });
    return {
      health: dash.network.health,
      overall_pct: dash.network.overall_pct,
      pace_delta: dash.network.pace_delta,
      drops: dash.drops.slice(0, 5),
      date: dash.date
    };
  });
}
