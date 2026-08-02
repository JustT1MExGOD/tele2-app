/**
 * v14 — branding, precise heatmap, report SVG, tenant
 * (без дублей путей v13)
 */
import { FastifyInstance } from 'fastify';
import { authPlugin, requireAuth, requireManager } from './middleware-auth.js';
import { buildDailyReportSvg } from './services/report-image.js';
import { getOrg, orgIdForEmployee, listStoresForOrg, upsertOrg } from './services/tenant.js';
import { logSaleEvents, hourMoscow, salesHeatmap, rebuildHourProfiles } from './services/heatmap.js';
import { todayMoscow } from './utils/date.js';

export async function registerV14Routes(app: FastifyInstance) {
  app.addHook('preHandler', authPlugin);

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
    } catch (e: any) {
      // fallback: all stores
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

  app.post('/admin/rebuild-hour-profiles', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const storeId = (request.body as any)?.store_id;
    return rebuildHourProfiles(storeId);
  });

  async function resolveBrand(request: any) {
    try {
      if (request.user?.employee_id) {
        const org = await getOrg(await orgIdForEmployee(request.user.employee_id));
        return {
          name: org.brand_name || org.name || 'T2 Sales',
          color: org.primary_color || '#2AABEE'
        };
      }
    } catch (_) {}
    return { name: 'T2 Sales', color: '#2AABEE' };
  }

  // JSON { svg }
  app.get('/reports/day/:storeId', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const storeId = String((request.params as any).storeId || '');
    const date = String((request.query as any)?.date || todayMoscow()).slice(0, 10);
    if (!storeId) return reply.code(400).send({ error: 'store_id_required' });
    try {
      const brand = await resolveBrand(request);
      const svg = await buildDailyReportSvg(storeId, date, brand);
      return {
        ok: true,
        store_id: storeId,
        date,
        content_type: 'image/svg+xml',
        svg,
        url: `/reports/svg?store_id=${encodeURIComponent(storeId)}&date=${date}`
      };
    } catch (e: any) {
      console.error('report svg failed:', e);
      return reply.code(500).send({
        error: 'report_failed',
        message: e?.message || String(e)
      });
    }
  });

  // raw SVG — отдельный path без :param.svg
  app.get('/reports/svg', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const q = (request.query || {}) as any;
    const storeId = String(q.store_id || '');
    const date = String(q.date || todayMoscow()).slice(0, 10);
    if (!storeId) return reply.code(400).send({ error: 'store_id_required' });
    try {
      const brand = await resolveBrand(request);
      const svg = await buildDailyReportSvg(storeId, date, brand);
      reply.header('Content-Type', 'image/svg+xml; charset=utf-8');
      return reply.send(svg);
    } catch (e: any) {
      return reply.code(500).send({ error: 'report_failed', message: e?.message || String(e) });
    }
  });

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
