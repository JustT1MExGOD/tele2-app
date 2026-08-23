/**
 * Брендинг + список сетей (admin) + пикер точек своей сети. Выделено из
 * routes-v14.ts (20.11.0, репо-реструктуризация) — точный heatmap уехал в
 * analytics/heatmap.ts.
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { requireAuth, requireManager, resolveViewOrgId } from '../../../auth/guards.js';
import { getOrg, orgIdForEmployee, listStoresForOrg, upsertOrg, listOrgs } from '../../../core/shared/tenant.js';
import { invalidateAll as invalidateAllScopes } from '../../../core/shared/scope-cache.js';
import type { OrgStoresResponse, BrandingResponse, OrgsListResponse, UpsertOrgResponse } from '../../../shared/api-types.js';

// upsertOrg(body: Partial<Org> & {id}) принимает произвольный поднабор
// полей organizations (name/brand_name/primary_color/logo_url/sector_id/
// chat_id/sales_thread_id/reports_thread_id/is_active) — не перечисляем
// каждое поимённо (та же логика, что у динамических тел метрик/планов),
// требуем только гарантированно NOT NULL name.
const UpsertOrgBody = Type.Object(
  {
    name: Type.String({ minLength: 1 })
  },
  { additionalProperties: true }
);
type UpsertOrgBody = Static<typeof UpsertOrgBody>;

export async function registerBrandingRoutes(app: FastifyInstance) {
  app.get('/branding', async (request): Promise<BrandingResponse> => {
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
  app.get('/orgs', async (request, reply): Promise<OrgsListResponse | FastifyReply | undefined> => {
    if (!requireManager(request, reply)) return;
    if (request.user?.role !== 'admin') {
      return reply.code(403).send({ error: 'admin only' });
    }
    return listOrgs();
  });

  app.put(
    '/admin/org/:id',
    { schema: { body: UpsertOrgBody } },
    async (request, reply): Promise<UpsertOrgResponse | FastifyReply | undefined> => {
    if (!requireManager(request, reply)) return;
    if (request.user?.role !== 'admin') {
      return reply.code(403).send({ error: 'admin only' });
    }
    const id = (request.params as any).id;
    const body = request.body as any;
    const org = await upsertOrg({ id, ...body });
    // upsertOrg может переставить organizations.sector_id — это меняет
    // набор точек ВСЕХ супервайзеров затронутых секторов (и старого, и
    // нового), точечная инвалидация по одному employee_id не применима
    // здесь. Операция редкая (админ правит сеть) — полный сброс не создаёт
    // заметной нагрузки.
    invalidateAllScopes();
    return org;
    }
  );

  // Точки своей сети — единый источник для всех пикеров точек во фронтенде
  // (см. fetchOrgStores() в 01-core.js). admin может явно затребовать другую
  // сеть тем же переключателем, что и везде (resolveViewOrgId) — остальные
  // роли override игнорируют и всегда видят только свою сеть.
  app.get('/org/stores', async (request, reply): Promise<OrgStoresResponse | undefined> => {
    if (!requireAuth(request, reply)) return;
    const { org_id } = request.query as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, org_id) || 'default';
    return { org_id: orgId, stores: await listStoresForOrg(orgId) };
  });
}
