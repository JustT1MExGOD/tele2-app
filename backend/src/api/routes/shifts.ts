/**
 * Смены (открытие/закрытие/текущая), быстрый разбор продажи по фразе (NLP)
 * и офлайн-очередь. Выделено из routes-v13.ts — было общей свалкой смен,
 * NLP, offline sync, live map, insights, alerts, what-if, forecast разом.
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { requireAuth, isManager, resolveViewOrgId, assertStoreInOrg } from '../../auth/guards.js';
import { parseSalePhrase } from '../../core/sales/nlp.js';
import { evaluateAfterSale, evaluateShiftClose, getGamificationProfile } from '../../core/employees/gamification.js';
import { generateShiftSummary } from '../../integrations/ai/client.js';
import { todayMoscow, toDateISO } from '../../utils/date.js';
import * as salesRepo from '../../data/repositories/sales.js';
import { claimIdempotencyKey } from '../../data/repositories/sync-log.js';
import * as shiftsRepo from '../../data/repositories/shifts.js';
import * as schedulesRepo from '../../data/repositories/schedules.js';
import * as tasksRepo from '../../data/repositories/tasks.js';
import * as employeesRepo from '../../data/repositories/employees.js';
import { notifyChat } from '../../integrations/telegram/bot.js';
import { getStoreNotifyTarget } from '../../core/shared/tenant.js';
import { computeDayPlanFact } from '../../core/shifts/pace.js';
import type {
  ShiftOpenResponse,
  ShiftCloseResponse,
  ShiftCurrentResponse,
  SalesParseResponse,
  SalesQuickResponse
} from '../../shared/api-types.js';

function num(v: any) {
  return Number(v) || 0;
}

// geoCoords() на фронте (11-v13.js) отдаёт {lat:null,lng:null,accuracy_m:null}
// целиком, когда геолокация недоступна/запрещена — это реальный, регулярный
// случай (не редкий edge case), не просто "поле не пришло". Null ДОЛЖЕН идти
// первым в Union — ajv (coerceTypes: true, дефолт Fastify) иначе тихо
// коэрсит null → 0 для типа number, что тут значило бы реальную (неверную)
// координату "0,0" вместо честного "геолокации нет" — обнаружено живым
// тестом на реальном фронтенд-сценарии, не гипотетически.
const NullableNumber = Type.Optional(Type.Union([Type.Null(), Type.Number()]));

const ShiftOpenBody = Type.Object({
  work_date: Type.Optional(Type.String()),
  store_id: Type.Optional(Type.String()),
  lat: NullableNumber,
  lng: NullableNumber,
  accuracy_m: NullableNumber
});
type ShiftOpenBody = Static<typeof ShiftOpenBody>;

const ShiftCloseBody = Type.Object({
  lat: NullableNumber,
  lng: NullableNumber,
  self_report: Type.Optional(Type.String()),
  mood: Type.Optional(Type.Integer()),
  blockers: Type.Optional(Type.String()),
  handover_note: Type.Optional(Type.String())
});
type ShiftCloseBody = Static<typeof ShiftCloseBody>;

const SalesParseBody = Type.Object({
  text: Type.Optional(Type.String())
});
type SalesParseBody = Static<typeof SalesParseBody>;

const SalesQuickBody = Type.Object({
  text: Type.Optional(Type.String()),
  employee_id: Type.Optional(Type.Number()),
  store_id: Type.Optional(Type.String()),
  sale_date: Type.Optional(Type.String()),
  org_id: Type.Optional(Type.String()),
  client_id: Type.Optional(Type.String())
});
type SalesQuickBody = Static<typeof SalesQuickBody>;

// ops — гетерогенный массив (сейчас с фронта уходят только type:'sale', но
// offline-очередь исторически задумана расширяемой, см. комментарий ниже
// про shift_open/close) — additionalProperties: true, схема не должна быть
// строже, чем обработчик: один плохой op помечается rejected в результатах,
// не роняя остальные валидные операции того же батча.
const SyncOp = Type.Object(
  {
    client_id: Type.Optional(Type.String()),
    type: Type.Optional(Type.String())
  },
  { additionalProperties: true }
);
const SyncBatchBody = Type.Object({
  ops: Type.Optional(Type.Array(SyncOp))
});
type SyncBatchBody = Static<typeof SyncBatchBody>;

export async function registerShiftsRoutes(app: FastifyInstance) {
  // ========== SHIFT SESSIONS ==========
  app.post(
    '/shifts/open',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { body: ShiftOpenBody } },
    async (request, reply): Promise<ShiftOpenResponse | FastifyReply | undefined> => {
    if (!requireAuth(request, reply)) return;
    const body = (request.body || {}) as ShiftOpenBody;
    const employee_id = request.user!.employee_id!;
    const date = String(body.work_date || todayMoscow()).slice(0, 10);

    // точка из графика или body
    let store_id = body.store_id;
    if (!store_id) {
      store_id = (await schedulesRepo.findScheduledStoreId(employee_id, date)) || undefined;
    }
    if (!store_id) {
      return reply.code(400).send({ error: 'store_id required (нет смены в графике)' });
    }
    // Раньше store_id из body принимался без проверки — любой сотрудник мог
    // открыть смену на точке совершенно чужой сети. "Подмена" на другой
    // точке легитимна, но только внутри своей же сети.
    if (!(await assertStoreInOrg(store_id, request.user!.org_id))) {
      return reply.code(403).send({ error: 'forbidden', message: 'Точка не принадлежит вашей сети' });
    }

    // закрыть висящие open
    await shiftsRepo.autoCloseHanging(employee_id);

    // Partial unique index (employee_id) WHERE status='open' — гонка: два
    // параллельных /shifts/open для одного сотрудника оба проходят
    // "закрыть висящие open" выше (в этот момент ещё ни одной 'open'-строки
    // нет), и без constraint оба вставили бы свою 'open'-сессию, оставляя
    // сотрудника с двумя одновременно "открытыми" сменами. Проигравший
    // ловит 23505 и получает уже открытую победителем сессию вместо ошибки.
    const { session, deduped } = await shiftsRepo.claimOpenSession(
      employee_id, store_id, date, body.lat ?? null, body.lng ?? null, body.accuracy_m ?? null
    );

    // Shift 2.0 (18.7) — фаза «до»: план на сегодня, передача от предыдущей
    // смены на этой точке (любой сотрудник), незакрытые задачи сотрудника.
    const [pace, handover, openTasks] = await Promise.all([
      computeDayPlanFact(employee_id, date),
      shiftsRepo.findLatestHandoverForStore(store_id),
      tasksRepo.findOpenForAssignee(employee_id)
    ]);

    return {
      ok: true,
      session,
      deduped,
      day_plan: pace.dayPlan,
      handover: handover || null,
      open_tasks: openTasks
    };
    }
  );

  app.post(
    '/shifts/close',
    { schema: { body: ShiftCloseBody } },
    async (request, reply): Promise<ShiftCloseResponse | FastifyReply | undefined> => {
    if (!requireAuth(request, reply)) return;
    const body = (request.body || {}) as ShiftCloseBody;
    const employee_id = request.user!.employee_id!;

    const sess = await shiftsRepo.findOpenForEmployee(employee_id);
    if (!sess) {
      return reply.code(400).send({ error: 'no open session' });
    }
    const date = toDateISO(sess.work_date);

    const { fact, dayPlan, planPct } = await computeDayPlanFact(employee_id, date);
    const score = num(fact.sim) + num(fact.mnp) * 2 + num(fact.pa) * 3 + num(fact.combo) * 2;
    const ideal = planPct >= 100 && num(fact.mnp) > 0;

    // почему смена не идеальная — для разбора, а не голой галочки
    const idealMissing: string[] = [];
    if (planPct < 100) idealMissing.push(`план дня не закрыт (${planPct}%)`);
    if (num(fact.mnp) === 0) idealMissing.push('нет MNP');

    // AND status = 'open' делает переход атомарным compare-and-swap: если
    // два запроса close (двойной тап, повторный клиентский ретрай) прочитали
    // один и тот же open-сессию до того, как любой из них успел её закрыть,
    // выигрывает только тот UPDATE, что выполнится первым — у второго
    // WHERE ... AND status='open' больше не совпадёт ни с одной строкой, и
    // он получит 0 обновлённых строк вместо того, чтобы тоже перевести уже
    // закрытую сессию в 'closed' и (что хуже) начислить награду второй раз.
    const closed = await shiftsRepo.closeSession(sess.id, {
      lat: body.lat ?? null,
      lng: body.lng ?? null,
      selfReport: body.self_report || null,
      mood: body.mood ?? null,
      blockers: body.blockers || null,
      ideal,
      score,
      handoverNote: body.handover_note || null
    });

    if (!closed) {
      // Проиграли гонку — другой параллельный запрос (или более ранний
      // ретрай того же клиента) уже закрыл именно эту сессию между нашим
      // SELECT и UPDATE. Не ошибка и не повод считать/начислять что-либо
      // заново — отдаём уже закрытую сессию как есть.
      const already = await shiftsRepo.findById(sess.id);
      return { ok: true, session: already, deduped: true };
    }

    // XP/бейджи/streak — не более одного раза за календарный день. Без этой
    // проверки open→close можно было спамить сколько угодно раз подряд (ни
    // open, ни close ничем не ограничены) и каждый close начислял полную
    // награду заново — бесконечный фарм XP/уровней/streak без единой
    // реальной продажи. Смена при этом всё равно закрывается нормально
    // (сохраняются score/факт/AI-разбор), просто повторное закрытие того же
    // дня не награждается второй раз.
    const alreadyRewarded = await shiftsRepo.hasOtherClosedToday(employee_id, date, sess.id);
    let gam: any;
    let rewarded = true;
    if (alreadyRewarded) {
      rewarded = false;
      const profile = await getGamificationProfile(employee_id);
      gam = { ...(profile || {}), xp_gained: 0, leveled_up: false };
    } else {
      gam = await evaluateShiftClose({
        employeeId: employee_id,
        score,
        ideal,
        planPct
      });
    }

    const factOut = { sim: num(fact.sim), mnp: num(fact.mnp), pa: num(fact.pa), combo: num(fact.combo) };
    const empRow = await employeesRepo.getContactInfo(employee_id);
    const aiSummary = await generateShiftSummary({
      employeeId: employee_id,
      employeeName: empRow?.full_name || 'Сотрудник',
      planPct,
      idealShift: ideal,
      fact: factOut,
      dayPlan,
      xpGained: gam?.xp_gained || 0,
      leveledUp: !!gam?.leveled_up,
      streakDays: gam?.streak_days || 0
    });

    return {
      ok: true,
      session: closed,
      plan_pct: planPct,
      ideal_shift: ideal,
      ideal_missing: idealMissing,
      score,
      fact: factOut,
      day_plan: dayPlan,
      gamification: gam,
      rewarded,
      ai_summary: aiSummary
    };
    }
  );

  app.get('/shifts/current', async (request, reply): Promise<ShiftCurrentResponse | undefined> => {
    if (!requireAuth(request, reply)) return;
    const session = await shiftsRepo.findCurrentOpenWithStore(request.user!.employee_id!);
    if (!session) return { session: null };

    // Shift 2.0 (18.7) — фаза «во время»: живой план/факт дня, пока смена
    // открыта, той же формулой, что при закрытии.
    const date = toDateISO(session.work_date);
    const pace = await computeDayPlanFact(request.user!.employee_id!, date);
    return { session, fact: pace.fact, day_plan: pace.dayPlan, plan_pct: pace.planPct };
  });

  // ========== NLP PARSE + OPTIONAL APPLY ==========
  app.post(
    '/sales/parse',
    { schema: { body: SalesParseBody } },
    async (request, reply): Promise<SalesParseResponse | undefined> => {
    if (!requireAuth(request, reply)) return;
    const body = (request.body || {}) as SalesParseBody;
    const parsed = parseSalePhrase(String(body.text || ''));
    return parsed;
    }
  );

  app.post(
    '/sales/quick',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { body: SalesQuickBody } },
    async (request, reply): Promise<SalesQuickResponse | FastifyReply | undefined> => {
    if (!requireAuth(request, reply)) return;
    const body = (request.body || {}) as SalesQuickBody;
    const parsed = parseSalePhrase(String(body.text || ''));
    if (!Object.keys(parsed.metrics).length) {
      return reply.code(400).send({ error: 'не удалось разобрать', parsed });
    }

    const employee_id = Number(body.employee_id || request.user!.employee_id);
    const isManagerRole = isManager(request.user);
    if (!isManagerRole && employee_id !== request.user!.employee_id) {
      return reply.code(403).send({ error: 'только свои продажи' });
    }

    let store_id = body.store_id;
    const sale_date = String(body.sale_date || todayMoscow()).slice(0, 10);
    if (!store_id) {
      store_id = (await schedulesRepo.findAnyScheduledStoreId(employee_id, sale_date)) || undefined;
    }
    if (!store_id) return reply.code(400).send({ error: 'store_id required' });

    // Точка должна быть в той же сети, что и пишущий — и когда manager
    // вносит продажу ЗА ДРУГОГО, и когда КТО УГОДНО вносит СВОЮ продажу на
    // другой точке ("подмена" легитимна, но только внутри своей сети).
    // Раньше проверка запускалась только в ветке "manager за другого".
    const writingForSelfQuick = employee_id === request.user!.employee_id;
    const orgIdQuick = isManagerRole && !writingForSelfQuick
      ? resolveViewOrgId(request.user!, body.org_id)
      : request.user!.org_id;
    if (!(await assertStoreInOrg(store_id, orgIdQuick))) {
      return reply.code(403).send({ error: 'forbidden', message: 'Точка не принадлежит вашей сети' });
    }

    const tg = request.user!.telegram_id ? Number(request.user!.telegram_id) : null;
    // Та же идемпотентность, что теперь и в основном POST /sales — без неё
    // повторный тап "Добавить" удваивал сумму (запись аддитивная).
    const clientId = body.client_id ? String(body.client_id).slice(0, 128) : null;
    if (clientId) {
      const fresh = await claimIdempotencyKey(clientId, employee_id, tg, body);
      if (!fresh) {
        const existing = await salesRepo.findOne(employee_id, store_id, sale_date);
        return { ok: true, deduped: true, parsed, sale: existing || null };
      }
    }

    // Единый с POST /sales и /sync/batch путь записи — раньше свой
    // отдельный INSERT без GREATEST(0, ...) (мог уйти в минус) и без
    // sales_audit/sales_events: продажи через быстрый ввод были невидимы
    // и в истории правок, и в heatmap.
    let row: any, applied: any[];
    try {
      ({ row, applied } = await salesRepo.applySaleUpsert({
        employee_id,
        store_id,
        sale_date,
        metrics: parsed.metrics,
        source: 'quick',
        createdByTelegramId: tg
      }));
    } catch (e: any) {
      if (e instanceof salesRepo.SaleMetricRangeError) {
        return reply.code(400).send({ error: 'metric_out_of_range', message: e.message });
      }
      throw e;
    }

    await evaluateAfterSale(employee_id, parsed.metrics);

    // Уведомление в чат — той же логикой, что основной /sales. Раньше его
    // тут не было: быстрый ввод происходил невидимо для команды в чате.
    try {
      const info = await salesRepo.getNotificationInfo(employee_id, store_id);
      if (info && applied.length) {
        const { saleNotificationMulti } = await import('../../integrations/telegram/messages.js');
        const text = await saleNotificationMulti({
          employeeName: info.full_name,
          storeName: info.store_name,
          items: applied.map((a) => ({ metric: a.metric, value: a.value }))
        });
        const target = await getStoreNotifyTarget(store_id, 'sales');
        await notifyChat(text, target.chatId, target.threadId);
      }
    } catch (_) {}

    return { ok: true, parsed, sale: row };
    }
  );

  // ========== OFFLINE SYNC ==========
  app.post(
    '/sync/batch',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { body: SyncBatchBody } },
    async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const body = (request.body || {}) as SyncBatchBody;
    const ops = Array.isArray(body.ops) ? body.ops : [];
    const results = [];

    for (const op of ops as any[]) {
      const client_id = String(op.client_id || '');
      if (!client_id) {
        results.push({ client_id, status: 'rejected', error: 'no client_id' });
        continue;
      }
      try {
        const fresh = await claimIdempotencyKey(
          client_id,
          request.user!.employee_id!,
          request.user!.telegram_id ? Number(request.user!.telegram_id) : null,
          op
        );
        if (!fresh) {
          results.push({ client_id, status: 'duplicate' });
          continue;
        }

        if (op.type === 'sale') {
          // делегируем на quick-логику через метрики
          const metrics = op.metrics || {};
          const employee_id = Number(op.employee_id || request.user!.employee_id);
          const store_id = op.store_id;
          const sale_date = String(op.sale_date || todayMoscow()).slice(0, 10);

          // Та же проверка, что в /sales/quick и основном POST /sales —
          // раньше офлайн-синхронизация вообще не проверяла ни "свой ли это
          // сотрудник", ни "своя ли сеть", employee_id/store_id брались из
          // тела как есть. Один плохой op не должен рушить весь batch —
          // кидаем Error, его ловит try/catch ниже и помечает just этот op.
          // "Своя" продажа (employee_id === себя) тоже проверяется — раньше
          // проверка сети запускалась только для "manager пишет за другого".
          if (employee_id !== request.user!.employee_id && !isManager(request.user)) {
            throw new Error('можно синхронизировать только свои продажи');
          }
          const orgIdSync = employee_id !== request.user!.employee_id
            ? resolveViewOrgId(request.user!, op.org_id)
            : request.user!.org_id;
          if (!store_id || !(await assertStoreInOrg(store_id, orgIdSync))) {
            throw new Error('точка не принадлежит вашей сети');
          }

          // Тот же путь записи, что у POST /sales и /sales/quick — раньше
          // тут был свой третий инлайн-INSERT без sales_audit/sales_events,
          // синхронизированные продажи не попадали ни в историю правок, ни
          // в heatmap. Идемпотентность здесь уже обеспечена снаружи (INSERT
          // в offline_sync_log по client_id чуть выше) — свой ключ внутрь
          // не передаём, иначе она сработала бы дважды на одном и том же op.
          if (store_id) {
            await salesRepo.applySaleUpsert({
              employee_id,
              store_id,
              sale_date,
              metrics,
              source: 'sync',
              createdByTelegramId: request.user!.telegram_id ? Number(request.user!.telegram_id) : null
            });
          }
        }
        // shift_open/shift_close никогда не ставятся в офлайн-очередь —
        // open/close смены всегда бьют в /shifts/open|close напрямую
        // (см. frontend/offline-queue.js: очередь умеет только sale).

        results.push({ client_id, status: 'applied' });
      } catch (e: any) {
        results.push({ client_id, status: 'rejected', error: e?.message || 'error' });
      }
    }

    return { ok: true, results };
    }
  );
}
