/**
 * Admin Control Center (20.59.0) — Overview: real counts only, each
 * from an existing repo query, org-scoped. No fabricated metrics.
 */
import { FastifyInstance } from 'fastify';
import { requireAdmin, resolveViewOrgId } from '../../../auth/guards.js';
import { todayMoscow } from '../../../utils/date.js';
import * as storesRepo from '../../../data/repositories/stores.js';
import * as employeesRepo from '../../../data/repositories/employees.js';
import * as shiftsRepo from '../../../data/repositories/shifts.js';
import * as accessRequestsRepo from '../../../data/repositories/access-requests.js';
import * as supportRepo from '../../../data/repositories/support.js';
import * as alertsRepo from '../../../data/repositories/alerts.js';

export async function registerAdminOverviewRoutes(app: FastifyInstance) {
  app.get('/admin/overview', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const orgId = resolveViewOrgId(request.user!, (request.query as any)?.org_id);

    const [stores, employees, shiftsToday, pendingAccess, tickets, alerts] = await Promise.all([
      storesRepo.countByOrg(orgId),
      employeesRepo.countByOrg(orgId),
      shiftsRepo.countOpenTodayForOrg(orgId, todayMoscow()),
      accessRequestsRepo.listPendingForOrg(orgId),
      supportRepo.listOpenQueue().catch(() => []),
      alertsRepo.listForOrg(orgId, 'open').catch(() => [])
    ]);

    return {
      stores,
      employees,
      shifts_today: shiftsToday,
      pending_access_requests: pendingAccess.length,
      open_support_tickets: tickets.length,
      active_alerts: alerts.length
    };
  });
}
