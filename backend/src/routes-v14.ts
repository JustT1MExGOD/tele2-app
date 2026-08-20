/**
 * v14 — branding, precise heatmap, tenant
 * Отчёты /reports/day — в index.ts (не дублировать)
 */
import { FastifyInstance } from 'fastify';
import { authPlugin, requireAuth, requireManager, resolveViewOrgId, requireStoreInOrg } from './middleware-auth.js';
import { getOrg, orgIdForEmployee, listStoresForOrg, upsertOrg, listOrgs } from './services/tenant.js';
import { logSaleEvents, hourMoscow, salesHeatmap, rebuildHourProfiles } from './services/heatmap.js';
import { serverError } from './utils/http-errors.js';

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

  // Список сетей — для переключателя сети в UI у admin (см. GET/POST /employees ?org_id=).
  app.get('/orgs', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    if (request.user?.role !== 'admin') {
      return reply.code(403).send({ error: 'admin only' });
    }
    return listOrgs();
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

  // Точки своей сети — единый источник для всех пикеров точек во фронтенде
  // (см. fetchOrgStores() в 01-core.js). admin может явно затребовать другую
  // сеть тем же переключателем, что и везде (resolveViewOrgId) — остальные
  // роли override игнорируют и всегда видят только свою сеть.
  app.get('/org/stores', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { org_id } = request.query as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, org_id) || 'default';
    return { org_id: orgId, stores: await listStoresForOrg(orgId) };
  });

  app.get(
    '/heatmap/precise/:storeId',
    { preHandler: [requireStoreInOrg('params', 'storeId', { allowOrgOverride: true })] },
    async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const storeId = (request.params as any).storeId;
    const weeks = Math.min(Number((request.query as any)?.weeks) || 4, 12);
    try {
      return await salesHeatmap(storeId, weeks);
    } catch (e: any) {
      return serverError(request, reply, 'heatmap_failed', e);
    }
    }
  );
  // POST /admin/rebuild-hour-profiles — уже в routes-forecast.ts, не дублировать

  // Раньше тут был POST /internal/log-sale-events — публичный HTTP-роут
  // ("internal" только в названии), requireAuth(любой активный сотрудник),
  // без проверки, что employee_id/store_id вообще существуют или свои —
  // можно было залить фальшивые события в heatmap на любого сотрудника
  // любой сети. Ни одного вызова с фронта не было — logSaleEvents()
  // уже вызывается напрямую из POST /sales (routes-sales.ts), через
  // авторизованный путь. Удалён вместо починки неиспользуемой копии.
}

export { logSaleEvents, hourMoscow, salesHeatmap };
