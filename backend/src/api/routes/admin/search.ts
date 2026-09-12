/**
 * Admin Control Center (20.59.0) — global search (Ctrl+K palette
 * backend). Permission-aware: always scoped to resolveViewOrgId, small
 * capped result sets per category, no fan-out beyond employees/stores.
 */
import { FastifyInstance } from 'fastify';
import { requireAdmin, resolveViewOrgId } from '../../../auth/guards.js';
import * as employeesRepo from '../../../data/repositories/employees.js';
import * as storesRepo from '../../../data/repositories/stores.js';

const PER_CATEGORY_LIMIT = 8;

export async function registerAdminSearchRoutes(app: FastifyInstance) {
  app.get('/admin/search', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const q = request.query as { q?: string; org_id?: string };
    const term = (q.q || '').trim();
    if (term.length < 2) return { employees: [], stores: [] };
    const orgId = resolveViewOrgId(request.user!, q.org_id);

    const [employees, stores] = await Promise.all([
      employeesRepo.searchByName(orgId, term, PER_CATEGORY_LIMIT),
      storesRepo.searchByNameOrCode(orgId, term, PER_CATEGORY_LIMIT)
    ]);

    return { employees, stores };
  });
}
