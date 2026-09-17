/**
 * Admin Control Center, Phase 4+ (Area B4) — Operations Center: system
 * health (open alerts + pending access requests) across ALL orgs,
 * deliberately no org filter — cross-org by design, unlike Command
 * Center (org-scoped, manager-facing). requireAdmin only. Read-only —
 * no ack/approve actions here, those stay in Command Center / the
 * existing access-request approval UI.
 */
import { FastifyInstance } from 'fastify';
import { requireAdmin } from '../../../auth/guards.js';
import * as alertsRepo from '../../../data/repositories/alerts.js';
import * as accessRequestsRepo from '../../../data/repositories/access-requests.js';

export async function registerAdminOperationsRoutes(app: FastifyInstance) {
  app.get('/admin/operations-overview', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;

    const [alerts, pendingAccess] = await Promise.all([
      alertsRepo.listOpenAll(),
      accessRequestsRepo.listPendingAll()
    ]);

    const alertsBySeverity: Record<string, number> = {};
    for (const a of alerts) {
      const sev = a.severity || 'unknown';
      alertsBySeverity[sev] = (alertsBySeverity[sev] || 0) + 1;
    }

    return {
      alerts,
      alerts_by_severity: alertsBySeverity,
      pending_access_requests: pendingAccess
    };
  });
}
