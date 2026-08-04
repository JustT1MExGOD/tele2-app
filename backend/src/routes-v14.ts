/**
 * v14 — branding, precise heatmap, tenant
 * Отчёты /reports/day — в index.ts (не дублировать)
 */
import { FastifyInstance } from 'fastify';
import { authPlugin, requireAuth, requireManager } from './middleware-auth.js';
import { getOrg, orgIdForEmployee, listStoresForOrg, upsertOrg } from './services/tenant.js';
import { logSaleEvents, hourMoscow, salesHeatmap, rebuildHourProfiles } from './services/heatmap.js';
import { todayMoscow } from './utils/date.js';

export async function registerV14Routes(app: FastifyInstance) {
  app.get('/branding', async (request) => {
    let orgId = 'default';
    if (request.user?.employee_id) {
      try {
        orgId = await orgIdForEmployee(request.user.employee_id);
      } catch (_) {}
    }
    try {
      const org = await getOrg(orgId);
      return {
        org_id: org.id,
        name: org.name,
        brand_name: org.brand_name || org.name,
        primary_color: org.primary_color || '#2AABEE',
        logo_url: org.logo_url,
        app_title: `${org.brand_name || 'T2'} Sales`
      };
    } catch {
      return {
        org_id: 'default',
        name: 'T2 Sales',
        brand_name: 'T2',
        primary_color: '#2AABEE',
        logo_url: null,
        app_title: 'T2 Sales'
      };
    }
  });

  app.put('/admin/org/:id', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    if (request.user?.role !== 'admin') {
      return reply.code(403).send({ error: 'admin only' });
    }
    const id = (request.params as any).id;
    const body = (request.body || {}) as any;
    return upsertOrg({ id, ...body });
  });

  app.get('/org/stores', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    try {
      const orgId = await orgIdForEmployee(request.user!.employee_id);
      return { org_id: orgId, stores: await listStoresForOrg(orgId) };
    } catch {
      const { query } = await import('./db/index.js');
      const res = await query(`SELECT * FROM stores ORDER BY name`);
      return { org_id: 'default', stores: res.rows };
    }
  });

  app.get('/heatmap/precise/:storeId', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const storeId = (request.params as any).storeId;
    const weeks = Math.min(Number((request.query as any)?.weeks) || 4, 12);
    try {
      return await salesHeatmap(storeId, weeks);
    } catch (e: any) {
      return reply.code(500).send({
        error: 'heatmap_failed',
        message: e?.message || 'heatmap error',
        hint: 'Накати sql/v14-roadmap.sql (sales_events)'
      });
    }
  });
  // POST /admin/rebuild-hour-profiles — уже в routes-v13.ts, не дублировать

  app.post('/internal/log-sale-events', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const b = (request.body || {}) as any;
    try {
      await logSaleEvents({
        employee_id: Number(b.employee_id),
        store_id: b.store_id,
        sale_date: b.sale_date || todayMoscow(),
        metrics: b.metrics || {},
        source: b.source || 'api',
        hour: b.hour != null ? Number(b.hour) : hourMoscow()
      });
      return { ok: true };
    } catch (e: any) {
      return reply.code(500).send({
        error: 'log_failed',
        message: e?.message || String(e),
        hint: 'CREATE TABLE sales_events — sql/v14-roadmap.sql'
      });
    }
  });
}

export { logSaleEvents, hourMoscow, salesHeatmap };
