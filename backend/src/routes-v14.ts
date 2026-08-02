/**
 * v14 — без дублей с v13:
 * branding, org, report SVG, log sale events
 * Heatmap точный: подмени services/forecast.ts или services/heatmap.ts
 * и в routes-v13 импортируй salesHeatmap из heatmap.js
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
      try { orgId = await orgIdForEmployee(request.user.employee_id); } catch (_) {}
    }
    const org = await getOrg(orgId);
    return {
      org_id: org.id,
      name: org.name,
      brand_name: org.brand_name || org.name,
      primary_color: org.primary_color || '#2AABEE',
      logo_url: org.logo_url,
      app_title: `${org.brand_name || 'T2'} Sales`
    };
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
    const orgId = await orgIdForEmployee(request.user!.employee_id);
    return { org_id: orgId, stores: await listStoresForOrg(orgId) };
  });

  // Точный heatmap — новый path, не конфликтует с v13 /heatmap/:storeId
  app.get('/heatmap/precise/:storeId', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const storeId = (request.params as any).storeId;
    const weeks = Math.min(Number((request.query as any)?.weeks) || 4, 12);
    return salesHeatmap(storeId, weeks);
  });

  app.post('/admin/rebuild-hour-profiles', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const storeId = (request.body as any)?.store_id;
    return rebuildHourProfiles(storeId);
  });

  app.get('/reports/day/:storeId.svg', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const storeId = (request.params as any).storeId;
    const date = String((request.query as any)?.date || todayMoscow()).slice(0, 10);
    let brand = { name: 'T2 Sales', color: '#2AABEE' };
    try {
      if (request.user?.employee_id) {
        const org = await getOrg(await orgIdForEmployee(request.user.employee_id));
        brand = { name: org.brand_name || org.name, color: org.primary_color || '#2AABEE' };
      }
    } catch (_) {}
    const svg = await buildDailyReportSvg(storeId, date, brand);
    reply.header('Content-Type', 'image/svg+xml; charset=utf-8');
    return reply.send(svg);
  });

  app.get('/reports/day/:storeId', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const storeId = (request.params as any).storeId;
    const date = String((request.query as any)?.date || todayMoscow()).slice(0, 10);
    let brand = { name: 'T2 Sales', color: '#2AABEE' };
    try {
      if (request.user?.employee_id) {
        const org = await getOrg(await orgIdForEmployee(request.user.employee_id));
        brand = { name: org.brand_name || org.name, color: org.primary_color || '#2AABEE' };
      }
    } catch (_) {}
    const svg = await buildDailyReportSvg(storeId, date, brand);
    return {
      store_id: storeId,
      date,
      content_type: 'image/svg+xml',
      svg,
      url: `/reports/day/${storeId}.svg?date=${date}`
    };
  });

  app.post('/internal/log-sale-events', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const b = (request.body || {}) as any;
    await logSaleEvents({
      employee_id: Number(b.employee_id),
      store_id: b.store_id,
      sale_date: b.sale_date || todayMoscow(),
      metrics: b.metrics || {},
      source: b.source || 'api',
      hour: b.hour != null ? Number(b.hour) : hourMoscow()
    });
    return { ok: true };
  });
}

export { logSaleEvents, hourMoscow, salesHeatmap };
