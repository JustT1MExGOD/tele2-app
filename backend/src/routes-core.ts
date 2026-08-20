/**
 * Справочные данные: шаблоны планов (точки — см. routes-stores.ts).
 * Вынесено из index.ts при разбиении монолита на модули.
 */
import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import { requireActive, resolveViewOrgId } from './middleware-auth.js';

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
      const day = await query(
        `SELECT sp.store_id, sp.plan_date,
                sp.sim, sp.mnp, sp.pa, sp.combo, sp.settings, sp.accessories, sp.insurance,
                sp.phones, sp.wink, sp.shpd, sp.focus, sp.credit_request, sp.credit_issued, sp.plotter, sp.hb
         FROM store_plans sp
         JOIN stores st ON st.id = sp.store_id
         WHERE sp.plan_date = $1 AND COALESCE(st.org_id, 'default') = $2
         ORDER BY sp.store_id`,
        [date, orgId]
      );
      if (day.rows.length) return day.rows;
    }
    const res = await query(
      `SELECT sp.store_id, sp.plan_date,
              sp.sim, sp.mnp, sp.pa, sp.combo, sp.settings, sp.accessories, sp.insurance,
              sp.phones, sp.wink, sp.shpd, sp.focus, sp.credit_request, sp.credit_issued
       FROM store_plans sp
       JOIN stores st ON st.id = sp.store_id
       WHERE sp.plan_date IS NULL AND COALESCE(st.org_id, 'default') = $1
       ORDER BY sp.store_id`,
      [orgId]
    );
    return res.rows;
  });
}
