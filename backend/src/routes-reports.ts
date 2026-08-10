/**
 * Отчёты по точке: SVG-картинка (тот же набор метрик, что в чате бота)
 * + ручная отправка микро/итогового отчёта в чат.
 * Вынесено из index.ts при разбиении монолита на модули.
 *
 * 14.10.0: убрана параллельная реализация рендера (buildDayReportSvgInline) —
 * она дублировала buildDailyReportSvg/buildStoryReportSvgs из report-image.ts,
 * только со статическим списком метрик вместо реального каталога, и служила
 * фолбэком на случай сбоя основного рендера. Если основной рендер падает —
 * это одна и та же БД и один и тот же путь до данных, второй самописный
 * рендерер её не спасёт, только даёт красивую иллюзию отказоустойчивости.
 */
import { FastifyInstance } from 'fastify';
import { todayMoscow } from './utils/date.js';
import { requireActive, requireManager, resolveViewOrgId, assertStoreInOrg } from './middleware-auth.js';
import { buildDailyReportSvg, buildStoryReportSvgs } from './services/report-image.js';

export async function registerReportsRoutes(app: FastifyInstance) {
  app.get('/reports/day/:storeId', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const storeId = String((request.params as any).storeId || '');
    const date = String((request.query as any)?.date || todayMoscow()).slice(0, 10);
    const kind = ((request.query as any)?.kind === 'micro' ? 'micro' : 'final') as 'micro' | 'final';
    if (!storeId) return reply.code(400).send({ error: 'store_id_required' });
    // Раньше любой активный сотрудник мог запросить превью отчёта чужой
    // точки, зная/угадав её id (слаги вроде "kalinina2" несложно угадать).
    const { org_id } = request.query as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, org_id);
    if (!(await assertStoreInOrg(storeId, orgId))) {
      return reply.code(403).send({ error: 'forbidden', message: 'Точка не принадлежит вашей сети' });
    }
    try {
      // 'final' в проде уходит в чат как story из 3 кадров (14.7.0) — превью
      // должно показывать то же самое, а не одиночную старую картинку.
      if (kind === 'final') {
        const svgs = await buildStoryReportSvgs(storeId, date);
        return { ok: true, store_id: storeId, date, kind: 'story', content_type: 'image/svg+xml', svgs };
      }
      const svg = await buildDailyReportSvg(storeId, date, { kind });
      return { ok: true, store_id: storeId, date, kind, content_type: 'image/svg+xml', svg };
    } catch (e: any) {
      request.log.error(e);
      return reply.code(500).send({ error: 'report_failed', message: e?.message || String(e) });
    }
  });

  /** Ручная отправка микро/итога в REPORT_CHAT_ID (для теста) */
  app.post('/reports/send-micro', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    try {
      const { sendMicroReports } = await import('./cron/reports.js');
      const body = (request.body || {}) as any;
      const date = String(body.date || todayMoscow()).slice(0, 10);
      const hour = Number(body.hour) || new Date(
        new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow' })
      ).getHours();
      const result = await sendMicroReports(date, hour);
      return result;
    } catch (e: any) {
      return reply.code(500).send({ error: 'send_failed', message: e?.message || String(e) });
    }
  });

  app.post('/reports/send-final', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    try {
      const { sendFinalReports } = await import('./cron/reports.js');
      const body = (request.body || {}) as any;
      const date = String(body.date || todayMoscow()).slice(0, 10);
      const result = await sendFinalReports(date);
      return result;
    } catch (e: any) {
      return reply.code(500).send({ error: 'send_failed', message: e?.message || String(e) });
    }
  });
}
