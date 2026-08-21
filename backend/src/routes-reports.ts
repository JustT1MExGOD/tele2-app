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
import { FastifyInstance, FastifyReply } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { todayMoscow } from './utils/date.js';
import { requireActive, requireManager, resolveViewOrgId, requireStoreInOrg } from './middleware-auth.js';
import { buildDailyReportSvg, buildStoryReportSvgs } from './services/report-image.js';
import { sendNetworkDigest } from './services/network-digest.js';
import { serverError } from './utils/http-errors.js';
import type { SendDigestResponse } from './shared/api-types.js';

const SendMicroBody = Type.Object({
  date: Type.Optional(Type.String()),
  hour: Type.Optional(Type.Number())
});
type SendMicroBody = Static<typeof SendMicroBody>;

const SendFinalBody = Type.Object({
  date: Type.Optional(Type.String())
});
type SendFinalBody = Static<typeof SendFinalBody>;

const SendDigestBody = Type.Object({
  kind: Type.Optional(Type.String()),
  org_id: Type.Optional(Type.String())
});
type SendDigestBody = Static<typeof SendDigestBody>;

export async function registerReportsRoutes(app: FastifyInstance) {
  app.get(
    '/reports/day/:storeId',
    // Раньше любой активный сотрудник мог запросить превью отчёта чужой
    // точки, зная/угадав её id (слаги вроде "kalinina2" несложно угадать).
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: [requireStoreInOrg('params', 'storeId', { allowOrgOverride: true })]
    },
    async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const storeId = String((request.params as any).storeId || '');
    const date = String((request.query as any)?.date || todayMoscow()).slice(0, 10);
    const kind = ((request.query as any)?.kind === 'micro' ? 'micro' : 'final') as 'micro' | 'final';
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
      return serverError(request, reply, 'report_failed', e);
    }
    }
  );

  /** Ручная отправка микро/итога в REPORT_CHAT_ID (для теста) */
  app.post(
    '/reports/send-micro',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { body: SendMicroBody } },
    async (request, reply) => {
    if (!requireManager(request, reply)) return;
    try {
      const { sendMicroReports } = await import('./cron/reports.js');
      const body = (request.body || {}) as SendMicroBody;
      const date = String(body.date || todayMoscow()).slice(0, 10);
      const hour = Number(body.hour) || new Date(
        new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow' })
      ).getHours();
      const result = await sendMicroReports(date, hour);
      return result;
    } catch (e: any) {
      return serverError(request, reply, 'send_failed', e);
    }
    }
  );

  app.post(
    '/reports/send-final',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { body: SendFinalBody } },
    async (request, reply) => {
    if (!requireManager(request, reply)) return;
    try {
      const { sendFinalReports } = await import('./cron/reports.js');
      const body = (request.body || {}) as SendFinalBody;
      const date = String(body.date || todayMoscow()).slice(0, 10);
      const result = await sendFinalReports(date);
      return result;
    } catch (e: any) {
      return serverError(request, reply, 'send_failed', e);
    }
    }
  );

  /** Ручная отправка недельной/месячной сводки по сети (18.9) — тот же
   * тест-триггер, что send-micro/send-final; ручная кнопка намеренно не
   * участвует в cron-claim, тот же осознанный выбор, что уже сделан там. */
  app.post(
    '/reports/send-digest',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { body: SendDigestBody } },
    async (request, reply): Promise<SendDigestResponse | FastifyReply | undefined> => {
    if (!requireManager(request, reply)) return;
    const body = (request.body || {}) as SendDigestBody;
    const kind = body.kind === 'monthly' ? 'monthly' : 'weekly';
    try {
      const orgId = resolveViewOrgId(request.user!, body.org_id);
      await sendNetworkDigest(kind, { orgId, bypassClaim: true });
      return { ok: true, kind };
    } catch (e: any) {
      return serverError(request, reply, 'send_failed', e);
    }
    }
  );
}
