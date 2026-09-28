/**
 * Google Sheets schedule import — вебхук со стороны Apps Script (см.
 * docs/SHEET-SCHEDULE-IMPORT.md). Не сессионный эндпоинт: таблица не
 * умеет ходить с куками/CSRF-токеном приложения, поэтому авторизация —
 * статический общий секрет в заголовке, как и в остальном проекте нет
 * прецедента (см. отчёт разведки при разработке — единственный похожий
 * код это auth/providers/telegram-verify.ts, но там HMAC над initData,
 * не сравнимо напрямую). Сравнение — тем же приёмом, что там: сначала
 * длины, потом crypto.timingSafeEqual, чтобы не открыть тайминг-канал.
 */
import { FastifyInstance } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import crypto from 'node:crypto';
import { importSheetScheduleEvent } from '../../../core/integrations/sheet-schedule-import.js';

const SheetWebhookBody = Type.Object({
  org_id: Type.String({ minLength: 1 }),
  // Пустая строка — «Apps Script не смог определить точку по цвету ячейки»
  // (например, ячейка выходного, не привязанная ни к одной точке); для
  // самой правки графика store_id обязателен только для настоящей смены,
  // это проверяется дальше в core/integrations/sheet-schedule-import.ts.
  store_id: Type.String({ maxLength: 100 }),
  employee_name: Type.String({ minLength: 1, maxLength: 200 }),
  work_date: Type.String({ minLength: 1, maxLength: 10 }),
  shift_raw: Type.String({ maxLength: 20 })
});
type SheetWebhookBody = Static<typeof SheetWebhookBody>;

function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function registerSheetsWebhookRoutes(app: FastifyInstance) {
  app.post(
    '/integrations/sheets/schedule-webhook',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } }, schema: { body: SheetWebhookBody } },
    async (request, reply) => {
      const expected = process.env.SHEETS_WEBHOOK_SECRET;
      if (!expected) {
        return reply.code(503).send({ error: 'not_configured', message: 'Импорт из Google Таблиц не настроен (нет SHEETS_WEBHOOK_SECRET)' });
      }
      const provided = request.headers['x-sheets-webhook-secret'];
      if (!secretMatches(typeof provided === 'string' ? provided : undefined, expected)) {
        return reply.code(401).send({ error: 'unauthorized' });
      }

      const body = request.body as SheetWebhookBody;
      const workDate = body.work_date.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
        return reply.code(400).send({ error: 'bad_request', message: 'work_date должен быть YYYY-MM-DD' });
      }

      const outcome = await importSheetScheduleEvent({
        orgId: body.org_id,
        storeId: body.store_id,
        employeeNameRaw: body.employee_name,
        workDate,
        shiftRaw: body.shift_raw
      });
      return outcome;
    }
  );
}
