/**
 * Справочные данные: шаблоны планов (точки — см. routes-stores.ts).
 * Вынесено из index.ts при разбиении монолита на модули.
 */
import { FastifyInstance } from 'fastify';
import { requireActive, resolveViewOrgId } from './middleware-auth.js';
import * as plansRepo from './repositories/plans.js';

export async function registerCoreRoutes(app: FastifyInstance) {
  // GET /stores переехал в routes-stores.ts (19.22.0, Data Access Layer).

  // ===== PLANS =====
  // ?date=YYYY-MM-DD → дневные планы на дату (если есть), иначе шаблон plan_date IS NULL
  // Та же поправка: раньше без auth, без фильтра по сети — шаблоны планов
  // всех точек всех сетей были публично читаемы.
  app.get('/plans', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const { date, org_id } = (request.query || {}) as { date?: string; org_id?: string };
    const orgId = resolveViewOrgId(request.user!, org_id);
    if (date) {
      const day = await plansRepo.findDayPlansForOrg(date, orgId);
      if (day.length) return day;
    }
    return plansRepo.findTemplatePlansForOrg(orgId);
  });
}
