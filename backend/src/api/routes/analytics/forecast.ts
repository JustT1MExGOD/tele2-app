/**
 * Прогноз, точный heatmap по часу, когорты новичков, BI-экспорт.
 * Выделено из routes-v13.ts.
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { requireAuth, requireManager, resolveViewOrgId, requireStoreInOrg } from '../../../auth/guards.js';
import { forecastStore, newbieCohorts, getStaffingHints } from '../../../core/analytics/forecast.js';
import { rebuildHourProfiles } from '../../../core/analytics/heatmap.js';
import { getLiveNetworkMap } from '../../../core/analytics/live-map.js';
import { generateForecastSummary, getLatestForecastSummary } from '../../../integrations/ai/client.js';
import { todayMoscow } from '../../../utils/date.js';
import * as storesRepo from '../../../data/repositories/stores.js';
import * as salesRepo from '../../../data/repositories/sales.js';
import type { ForecastResponse, StaffingHintsResponse } from '../../../shared/api-types.js';

export async function registerForecastRoutes(app: FastifyInstance) {
  app.get(
    '/forecast/:storeId',
    {
      // 20.50.0 (Web Security & Trust Layer, часть 3) — дёргает Groq при
      // отсутствии кэша, реальные деньги за вызов; не должен быть частым.
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: [requireStoreInOrg('params', 'storeId', { allowOrgOverride: true })]
    },
    async (request, reply): Promise<ForecastResponse | FastifyReply | undefined> => {
    if (!requireAuth(request, reply)) return;
    const { storeId } = request.params as { storeId: string };
    const from = String((request.query as any)?.from || todayMoscow()).slice(0, 10);
    const days = Math.min(Number((request.query as any)?.days) || 7, 14);
    const fc = await forecastStore(storeId, from, days);

    // AI только объясняет уже посчитанный прогноз словами, раз в день на
    // точку (кэш в ai_audit, ключ — (storeId, from)). 20.50.0 — from был
    // полностью клиентским, а кэш ключуется именно по нему: разные from на
    // каждый запрос давали разные кэш-ключи и свежий Groq-вызов на КАЖДЫЙ
    // запрос, а не раз в день, как обещал комментарий. Генерируем сводку
    // только для today — единственный кейс, где "раз в день на точку"
    // вообще имеет смысл; для любой другой даты отдаём null без вызова AI.
    let aiSummary = await getLatestForecastSummary(storeId, from);
    if (!aiSummary && fc.history_days >= 7 && from === todayMoscow()) {
      const storeName = await storesRepo.findDisplayName(storeId);
      aiSummary = await generateForecastSummary({
        storeId,
        storeName: storeName || storeId,
        date: from,
        items: fc.items
      });
    }

    return { store_id: storeId, ...fc, ai_summary: aiSummary };
    }
  );

  // «Кого куда поставить» — эвристика на основе прогноза + текущего графика,
  // не точный расчёт (абсолютной меры «нужно N человек» у нас нет).
  app.get(
    '/staffing-hints',
    // 20.50.0 — цикл forecastStore() по каждой точке сети (N последовательных
    // тяжёлых запросов), без лимита раньше не было вообще никакой защиты.
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply): Promise<StaffingHintsResponse | undefined> => {
    if (!requireManager(request, reply)) return;
    const { org_id } = request.query as { org_id?: string };
    const days = Math.min(Number((request.query as any)?.days) || 7, 14);
    return { items: await getStaffingHints(days, resolveViewOrgId(request.user!, org_id)) };
    }
  );

  app.get('/cohorts/newbies', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { org_id } = request.query as { org_id?: string };
    return newbieCohorts(resolveViewOrgId(request.user!, org_id));
  });

  // Пересчёт почасовых профилей — обслуживающая операция над всей БД разом,
  // ничего чужого не показывает наружу, поэтому без scoping по сети.
  app.post(
    '/admin/rebuild-hour-profiles',
    // 20.50.0 — пересчёт по ВСЕЙ БД разом (см. комментарий выше), редкое
    // admin-действие, не должно вызываться часто ни намеренно, ни по ошибке.
    // Security audit (20.52.0) — комментарий уже называл это "admin-
    // действием", но гвард был requireManager: любой manager любой сети
    // мог форсировать полный пересчёт по всей БД. Приведено в соответствие.
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
    if (!requireManager(request, reply)) return;
    if (request.user!.role !== 'admin') {
      return reply.code(403).send({ error: 'forbidden', message: 'Только для администратора' });
    }
    return rebuildHourProfiles();
    }
  );

  // ========== BI EXPORT (JSON truth) ==========
  app.get(
    '/export/bi/daily',
    // 20.50.0 — дамп продаж + getLiveNetworkMap() (N+1 по точкам сети) в
    // одном ответе, раньше без собственного лимита.
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { org_id } = request.query as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, org_id);
    const date = String((request.query as any)?.date || todayMoscow()).slice(0, 10);
    const sales = await salesRepo.findForBiDaily(date, orgId);
    const live = await getLiveNetworkMap(orgId);
    return {
      source: 't2-sales-app',
      generated_at: new Date().toISOString(),
      date,
      sales,
      network: live
    };
    }
  );
}
