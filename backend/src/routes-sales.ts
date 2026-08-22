/**
 * Продажи: список за день + внесение/правка метрик.
 * Вынесено из index.ts при разбиении монолита на модули.
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { query, withTransaction } from './db/index.js';
import { notifyChat } from './bot/index.js';
import { todayMoscow } from './utils/date.js';
import { requireActive, requireManager, resolveViewOrgId, assertStoreInOrg } from './middleware-auth.js';
import { getSalesSumColumns } from './services/metrics-catalog.js';
import { getStoreNotifyTarget } from './services/tenant.js';
import { applySaleUpsert, claimIdempotencyKey, SaleMetricRangeError } from './services/sales-write.js';
import { recordAudit } from './services/audit.js';
import type { SalesListResponse, SaleRow } from './shared/api-types.js';

// employee_id/store_id — единственные поля, форма которых реально важна на
// границе API; сами метрики (sim/mnp/... + произвольные кастомные) остаются
// additionalProperties — их набор задаётся динамически через каталог метрик
// (services/metrics-catalog.ts), схема на уровне HTTP их не перечисляет, это
// уже корректно фильтрует сам обработчик (regex + Number()) ниже по коду.
const PostSaleBody = Type.Object(
  {
    employee_id: Type.Number(),
    store_id: Type.String({ minLength: 1 }),
    sale_date: Type.Optional(Type.String()),
    client_id: Type.Optional(Type.String()),
    org_id: Type.Optional(Type.String())
  },
  { additionalProperties: true }
);
type PostSaleBody = Static<typeof PostSaleBody>;

const ZeroSaleBody = Type.Object({
  metric: Type.String({ minLength: 1 })
});
type ZeroSaleBody = Static<typeof ZeroSaleBody>;

export async function registerSalesRoutes(app: FastifyInstance) {
  // Раньше эндпоинт вообще не проверял авторизацию и не фильтровал по сети —
  // отдавал продажи всех сетей за день кому угодно с валидным (или вообще
  // без) X-Telegram-Id. Тот же паттерн self-inclusion, что и в /schedules:
  // своя запись видна всегда, даже если сегодня подменяешь в чужой сети.
  app.get('/sales', async (request, reply): Promise<SalesListResponse | undefined> => {
    if (!requireActive(request, reply)) return;
    const { date, org_id } = request.query as { date?: string; org_id?: string };
    const saleDate = date || todayMoscow();
    const orgId = resolveViewOrgId(request.user!, org_id);

    const res = await query(
      `SELECT s.*, e.full_name, COALESCE(st.display_name, st.name) as store_name
       FROM sales s
       JOIN employees e ON e.id = s.employee_id
       JOIN stores st ON st.id = s.store_id
       WHERE s.sale_date = $1
         AND (COALESCE(st.org_id, 'default') = $2 OR s.employee_id = $3)
       ORDER BY e.full_name`,
      [saleDate, orgId, request.user!.employee_id]
    );
    return res.rows;
  });

  // Прибавление метрик (+ правка через delta отрицательный)
  app.post(
    '/sales',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { body: PostSaleBody } },
    async (request, reply): Promise<SaleRow | { ok: true; deduped: true } | FastifyReply | undefined> => {
    if (!requireActive(request, reply)) return;
    const user = request.user!;
    const body = request.body as any;
    const employee_id = Number(body.employee_id);
    const store_id = body.store_id;
    const sale_date = body.sale_date || todayMoscow();

    if (!employee_id || !store_id) {
      return reply.code(400).send({ error: 'employee_id and store_id required' });
    }

    // employee может писать только за себя; manager/admin — за всех
    const isManagerRole = user.role === 'manager' || user.role === 'admin';
    const writingForSelf = Number(user.employee_id) === employee_id;
    if (!isManagerRole && !writingForSelf) {
      return reply.code(403).send({
        error: 'forbidden',
        message: 'Можно вносить продажи только за себя'
      });
    }
    // Точка должна быть в той же сети, что и пишущий — и когда manager
    // вносит продажу ЗА ДРУГОГО (тогда сеть может быть выбрана
    // admin-переключателем, resolveViewOrgId), и когда КТО УГОДНО вносит
    // СВОЮ продажу на другой точке ("подмена" — легитимный сценарий), но
    // только внутри своей же сети. Раньше эта проверка запускалась ТОЛЬКО
    // в ветке "manager пишет за другого" — свою продажу можно было указать
    // на точке вообще любой чужой сети без единой проверки принадлежности.
    const orgId = isManagerRole && !writingForSelf ? resolveViewOrgId(user, body.org_id) : user.org_id;
    if (!(await assertStoreInOrg(store_id, orgId))) {
      return reply.code(403).send({ error: 'forbidden', message: 'Точка не принадлежит вашей сети' });
    }
    const tg = user.telegram_id ? Number(user.telegram_id) : null;

    // Идемпотентность: тот же offline_sync_log/client_id, что уже был
    // только в /sync/batch — раньше повторный тап "Добавить" (нетерпеливый
    // палец на сенсорном экране) или сетевой ретрай после успешного, но
    // не дошедшего до клиента ответа тихо удваивал сумму продажи, потому
    // что запись аддитивная (+=). Ключ необязательный — старые клиенты без
    // client_id работают как раньше, просто без этой защиты.
    const clientId = body.client_id ? String(body.client_id).slice(0, 128) : null;
    if (clientId) {
      const fresh = await claimIdempotencyKey(clientId, employee_id, tg, body);
      if (!fresh) {
        const existing = await query(
          `SELECT * FROM sales WHERE employee_id = $1 AND store_id = $2 AND sale_date = $3`,
          [employee_id, store_id, sale_date]
        );
        return existing.rows[0] || { ok: true, deduped: true };
      }
    }

    // Базовые + кастомные (import/imp/esim и любые ключи body a-z0-9_)
    const baseFields = [
      'sim', 'mnp', 'pa', 'combo', 'settings', 'accessories', 'insurance',
      'phones', 'wink', 'shpd', 'focus', 'credit_request', 'credit_issued',
      'plotter', 'hb', 'import', 'imp', 'esim'
    ];
    const extraFromBody = Object.keys(body || {}).filter(
      (k) =>
        /^[a-z][a-z0-9_]{0,29}$/.test(k) &&
        !baseFields.includes(k) &&
        !['employee_id', 'store_id', 'sale_date', 'date', 'id', 'client_id', 'org_id'].includes(k)
    );
    const fields = [...baseFields, ...extraFromBody];

    const metrics: Record<string, number> = {};
    for (const f of fields) {
      if (body[f] !== undefined && body[f] !== null && body[f] !== '') {
        const val = Number(body[f]) || 0;
        if (Number.isFinite(val)) metrics[f] = val;
      }
    }

    if (!Object.keys(metrics).length) {
      return reply.code(400).send({ error: 'no metrics', message: 'Не выбраны метрики или колонка отсутствует в sales' });
    }

    let row: any, applied: any[];
    try {
      ({ row, applied } = await applySaleUpsert({
        employee_id,
        store_id,
        sale_date,
        metrics,
        source: 'api',
        createdByTelegramId: tg
      }));
    } catch (e: any) {
      if (e instanceof SaleMetricRangeError) {
        return reply.code(400).send({ error: 'metric_out_of_range', message: e.message });
      }
      throw e;
    }

    try {
      const info = await query(
        `SELECT e.full_name, COALESCE(st.display_name, st.name) as store_name
         FROM employees e, stores st
         WHERE e.id = $1 AND st.id = $2`,
        [employee_id, store_id]
      );
      if (info.rows[0] && applied.length) {
        const { saleNotificationMulti } = await import('./bot/messages.js');
        const text = await saleNotificationMulti({
          employeeName: info.rows[0].full_name,
          storeName: info.rows[0].store_name,
          items: applied.map((a) => ({ metric: a.metric, value: a.value }))
        });
        const target = await getStoreNotifyTarget(store_id, 'sales');
        await notifyChat(text, target.chatId, target.threadId);
      }
    } catch (_) {}

    return row;
    }
  );

  // Отменить ошибочно внесённую метрику за день (manager/admin).
  // sales — одна строка на employee+store+day, метрики аддитивные, поэтому
  // "удаление" — это обнуление конкретной колонки в этой строке, а не удаление
  // всей строки (другие метрики за этот день могли быть внесены верно).
  app.put(
    '/sales/:id/zero',
    { schema: { body: ZeroSaleBody } },
    async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const { metric } = request.body as ZeroSaleBody;

    const validCols = await getSalesSumColumns();
    if (!validCols.includes(metric)) {
      return reply.code(400).send({ error: 'unknown metric' });
    }

    const before = await query(
      `SELECT ${metric} as val, employee_id, store_id, sale_date FROM sales WHERE id = $1`,
      [id]
    );
    if (!before.rows[0]) return reply.code(404).send({ error: 'not found' });
    // Точка продажи должна быть в сети менеджера — иначе manager одной сети
    // мог бы обнулять метрики продаж на точках вообще любой другой сети.
    const { org_id } = (request.query || {}) as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, org_id);
    if (!(await assertStoreInOrg(before.rows[0].store_id, orgId))) {
      return reply.code(403).send({ error: 'forbidden', message: 'Точка не принадлежит вашей сети' });
    }
    const prevVal = Number(before.rows[0].val) || 0;
    const user = request.user!;

    // 19.23.0 (Audit Trail): UPDATE + sales_audit + audit_log — одна
    // транзакция. Раньше запись в sales_audit была best-effort (.catch(()
    // => {}) — обнуление метрики могло пройти без единого следа в истории
    // правок при сбое второго запроса). Теперь либо обе записи, либо
    // обнуления не было вообще — то самое "transactional audit".
    const row = await withTransaction(async (q) => {
      const res = await q(
        `UPDATE sales SET ${metric} = 0, updated_at = now() WHERE id = $1 RETURNING *`,
        [id]
      );

      if (prevVal !== 0) {
        await q(
          `INSERT INTO sales_audit (employee_id, store_id, sale_date, metric, delta, source, created_by)
           VALUES ($1,$2,$3,$4,$5,'correction',$6)`,
          [
            before.rows[0].employee_id,
            before.rows[0].store_id,
            before.rows[0].sale_date,
            metric,
            -prevVal,
            user.telegram_id ? Number(user.telegram_id) : null
          ]
        );
        await recordAudit(q, {
          orgId,
          actorEmployeeId: user.employee_id,
          actorTelegramId: user.telegram_id ? Number(user.telegram_id) : null,
          action: 'sales.correction',
          targetType: 'sale',
          targetId: id,
          before: { [metric]: prevVal },
          after: { [metric]: 0 },
          requestId: request.id
        });
      }

      return res.rows[0];
    });

    return row;
    }
  );
}
