import { withTransaction } from '../../data/db/index.js';
import { saveDaySnapshot } from '../../data/repositories/plan-batches.js';
/**
 * Смены (открытие/закрытие/текущая), быстрый разбор продажи по фразе (NLP)
 * и офлайн-очередь. Выделено из routes-v13.ts — было общей свалкой смен,
 * NLP, offline sync, live map, insights, alerts, what-if, forecast разом.
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { requireActive, canWriteSalesForOthers, resolveViewOrgId, assertStoreInOrg } from '../../auth/guards.js';
import { resolveStoreEligibility, resolveSaleStoreOrgId } from '../../core/shifts/work-context.js';
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
  SalesQuickResponse,
  ResolveStoreResponse
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
  store_code: Type.Optional(Type.String()),
  lat: NullableNumber,
  lng: NullableNumber,
  accuracy_m: NullableNumber
});
type ShiftOpenBody = Static<typeof ShiftOpenBody>;

const ResolveStoreBody = Type.Object({
  code: Type.String({ minLength: 1 })
});
type ResolveStoreBody = Static<typeof ResolveStoreBody>;

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
  ops: Type.Optional(Type.Array(SyncOp, {maxItems:100}))
});
type SyncBatchBody = Static<typeof SyncBatchBody>;

export async function registerShiftsRoutes(app: FastifyInstance) {
  // ========== REPLACEMENT SHIFT: RESOLVE STORE CODE (preview, no mutation) ==========
  // POST /shifts/resolve-store — employee types a store code manually; this
  // tells them whether it's their own store (NORMAL), a same-sector foreign
  // store they may work as a replacement (REPLACEMENT), or blocked, WITHOUT
  // opening anything yet. /shifts/open re-checks the identical rules before
  // actually persisting — this is a preview, not the authorization itself.
  app.post(
    '/shifts/resolve-store',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { body: ResolveStoreBody } },
    async (request, reply): Promise<ResolveStoreResponse | undefined> => {
      if (!requireActive(request, reply)) return;
      const { code } = request.body as ResolveStoreBody;
      const user = request.user!;
      const result = await resolveStoreEligibility(
        { employeeId: user.employee_id!, homeOrgId: user.org_id, role: user.role },
        { storeCode: code }
      );
      // workOrgId (raw org id) is an internal decision input, not something
      // the client needs or should see — only code/name/address + mode.
      return { allowed: result.allowed, message: result.message, store: result.store, mode: result.mode };
    }
  );

  // ========== SHIFT SESSIONS ==========
  app.post(
    '/shifts/open',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { body: ShiftOpenBody } },
    async (request, reply): Promise<ShiftOpenResponse | FastifyReply | undefined> => {
    if (!requireActive(request, reply)) return;
    const body = (request.body || {}) as ShiftOpenBody;
    const employee_id = request.user!.employee_id!;
    const date = String(body.work_date || todayMoscow()).slice(0, 10);

    // Точка: код (замена, ручной ввод) > store_id из body > график.
    // Раньше store_id из body принимался с одной проверкой (своя сеть) — та
    // же проверка теперь идёт через resolveStoreEligibility(), которая для
    // точки своей сети даёт идентичный результат (mode=NORMAL), и
    // дополнительно разрешает точку чужой сети того же сектора (замена).
    let store_id = body.store_code ? undefined : body.store_id;
    let selectionSource: 'SCHEDULE' | 'MANUAL_CODE' = body.store_code ? 'MANUAL_CODE' : 'SCHEDULE';
    if (!body.store_code && !store_id) {
      store_id = (await schedulesRepo.findScheduledStoreId(employee_id, date)) || undefined;
    }
    if (!body.store_code && !store_id) {
      return reply.code(400).send({ error: 'store_id required (нет смены в графике)' });
    }
    const eligibility = await resolveStoreEligibility(
      { employeeId: employee_id, homeOrgId: request.user!.org_id, role: request.user!.role },
      body.store_code ? { storeCode: body.store_code } : { storeId: store_id }
    );
    if (!eligibility.allowed || !eligibility.store || !eligibility.mode || !eligibility.workOrgId) {
      return reply.code(403).send({ error: 'forbidden', message: eligibility.message || 'Точка недоступна' });
    }
    store_id = eligibility.store.id;
    const workContext = { orgId: eligibility.workOrgId, workMode: eligibility.mode, selectionSource };

    return withTransaction(async () => {
    await shiftsRepo.lockEmployee(employee_id);
    // Закрываем только смены предыдущих дней.
    await shiftsRepo.autoCloseHanging(employee_id, date);

    // Partial unique index (employee_id) WHERE status='open' — гонка: два
    // параллельных /shifts/open для одного сотрудника оба проходят
    // "закрыть висящие open" выше (в этот момент ещё ни одной 'open'-строки
    // нет), и без constraint оба вставили бы свою 'open'-сессию, оставляя
    // сотрудника с двумя одновременно "открытыми" сменами. Проигравший
    // ловит 23505 и получает уже открытую победителем сессию вместо ошибки.
    const { session, deduped } = await shiftsRepo.claimOpenSession(
      employee_id, store_id, date, body.lat ?? null, body.lng ?? null, body.accuracy_m ?? null, workContext
    );

    // Shift 2.0 (18.7) — фаза «до»: план на сегодня, передача от предыдущей
    // смены на этой точке (любой сотрудник), незакрытые задачи сотрудника.
    const [pace, handover, openTasks] = await Promise.all([
      computeDayPlanFact(employee_id, date),
      shiftsRepo.findLatestHandoverForStore(store_id),
      tasksRepo.findOpenForAssignee(employee_id)
    ]);

    const snapshot=await saveDaySnapshot(session.id,pace.dayPlan);
    return {
      ok: true,
      session,
      deduped,
      day_plan: snapshot,
      handover: handover || null,
      open_tasks: openTasks
    };
    });
    }
  );

  app.post(
    '/shifts/close',
    // 20.50.0 — дёргает Groq (generateShiftSummary) на каждом закрытии;
    // сиблинг /shifts/open уже 30/мин, симметрично.
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { body: ShiftCloseBody } },
    async (request, reply): Promise<ShiftCloseResponse | FastifyReply | undefined> => {
    if (!requireActive(request, reply)) return;
    const body = (request.body || {}) as ShiftCloseBody;
    const employee_id = request.user!.employee_id!;

    const result = await withTransaction(async () => {
    // Employee row serializes close/reward transitions, including reopen/close races.
    await shiftsRepo.lockEmployee(employee_id);
    const sess = await shiftsRepo.findOpenForEmployee(employee_id);
    if (!sess) {
      const cached=await shiftsRepo.latestCloseResult(employee_id,null);
      if(cached) return {...cached,deduped:true,rewarded:false,gamification:{...cached.gamification,xp_gained:0,leveled_up:false}};
      throw Object.assign(new Error('no open session'),{statusCode:400});
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
        planPct,
        workDate:date
      });
    }

    const factOut = { sim: num(fact.sim), mnp: num(fact.mnp), pa: num(fact.pa), combo: num(fact.combo) };
    const output = {
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
      ai_summary: ''
    };
    await shiftsRepo.saveCloseResult(sess.id,output);
    return output;
    });
    // AI is optional enrichment after COMMIT: a provider failure must not undo a shift.
    if (!result.deduped && result.fact) {
      try {
        const employee = await employeesRepo.getContactInfo(employee_id);
        result.ai_summary = await generateShiftSummary({employeeId:employee_id,
          employeeName:employee?.full_name || 'Сотрудник',planPct:result.plan_pct,
          idealShift:result.ideal_shift,fact:result.fact,dayPlan:result.day_plan,
          xpGained:result.gamification?.xp_gained || 0,leveledUp:!!result.gamification?.leveled_up,
          streakDays:result.gamification?.streak_days || 0});
        await shiftsRepo.saveCloseResult(result.session.id,result);
      } catch (err) { request.log.warn({err},'Shift saved; summary unavailable'); }
    }
    return result;
    }
  );

  app.get('/shifts/current', async (request, reply): Promise<ShiftCurrentResponse | undefined> => {
    if (!requireActive(request, reply)) return;
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
    if (!requireActive(request, reply)) return;
    const body = (request.body || {}) as SalesParseBody;
    const parsed = parseSalePhrase(String(body.text || ''));
    return parsed;
    }
  );

  app.post(
    '/sales/quick',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { body: SalesQuickBody } },
    async (request, reply): Promise<SalesQuickResponse | FastifyReply | undefined> => {
    if (!requireActive(request, reply)) return;
    const body = (request.body || {}) as SalesQuickBody;
    const parsed = parseSalePhrase(String(body.text || ''));
    if (!Object.keys(parsed.metrics).length) {
      return reply.code(400).send({ error: 'не удалось разобрать', parsed });
    }

    const employee_id = Number(body.employee_id || request.user!.employee_id);
    // senior — намеренно нет, см. canWriteSalesForOthers в auth/guards.ts.
    const isManagerRole = canWriteSalesForOthers(request.user);
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
    // Своя продажа ("writing for self") дополнительно разрешена на точке
    // чужой сети, если ИМЕННО там у сотрудника сейчас открыта смена в
    // режиме REPLACEMENT (resolveSaleStoreOrgId) — не любая точка сектора,
    // только точка активной смены; иначе (manager за другого) поведение не
    // менялось.
    const writingForSelfQuick = employee_id === request.user!.employee_id;
    let orgIdQuick: string | null;
    if (isManagerRole && !writingForSelfQuick) {
      orgIdQuick = resolveViewOrgId(request.user!, body.org_id);
      if (!(await assertStoreInOrg(store_id, orgIdQuick))) orgIdQuick = null;
    } else {
      orgIdQuick = await resolveSaleStoreOrgId(employee_id, store_id, request.user!.org_id);
    }
    if (!orgIdQuick) {
      return reply.code(403).send({ error: 'forbidden', message: 'Точка не принадлежит вашей сети' });
    }

    const tg = request.user!.telegram_id ? Number(request.user!.telegram_id) : null;
    // Та же идемпотентность, что теперь и в основном POST /sales — без неё
    // повторный тап "Добавить" удваивал сумму (запись аддитивная).
    const clientId = body.client_id ? String(body.client_id).slice(0, 128) : null;
    let row: any, applied: any[], deduped: boolean | undefined;
    try {
      ({ row, applied, deduped } = await salesRepo.applySaleUpsert({
        employee_id,
        store_id,
        sale_date,
        metrics: parsed.metrics,
        source: 'quick',
        clientId,
        createdByTelegramId: tg
      }));
    } catch (e: any) {
      if (e instanceof salesRepo.SaleMetricRangeError) {
        return reply.code(400).send({ error: 'metric_out_of_range', message: e.message });
      }
      throw e;
    }



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

    return { ok: true, parsed, sale: row, deduped };
    }
  );

  // ========== OFFLINE SYNC ==========
  app.post(
    '/sync/batch',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { body: SyncBatchBody } },
    async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const body = (request.body || {}) as SyncBatchBody;
    const ops = Array.isArray(body.ops) ? body.ops : [];
    const results = [];

    for (const op of ops as any[]) {
      const client_id = String(op.client_id || '');
      if (!client_id) {
        results.push({ client_id, status: 'rejected', retryable:false, error: 'no client_id' });
        continue;
      }
      try {
        let deduped=false;
        if (op.type !== 'sale') throw Object.assign(new Error('Неизвестный тип операции'),{statusCode:400});
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
          // senior — намеренно нет, см. canWriteSalesForOthers в auth/guards.ts.
          if (employee_id !== request.user!.employee_id && !canWriteSalesForOthers(request.user)) {
            throw new Error('можно синхронизировать только свои продажи');
          }
          // Same replacement-shift allowance as /sales/quick above — own
          // sale, foreign store, only if that's exactly the active
          // REPLACEMENT shift's store.
          let orgIdSync: string | null;
          if (employee_id !== request.user!.employee_id) {
            orgIdSync = resolveViewOrgId(request.user!, op.org_id);
            if (!store_id || !(await assertStoreInOrg(store_id, orgIdSync))) orgIdSync = null;
          } else {
            orgIdSync = store_id ? await resolveSaleStoreOrgId(employee_id, store_id, request.user!.org_id) : null;
          }
          if (!orgIdSync) {
            throw new Error('точка не принадлежит вашей сети');
          }

          // Тот же путь записи, что у POST /sales и /sales/quick — раньше
          // тут был свой третий инлайн-INSERT без sales_audit/sales_events,
          // синхронизированные продажи не попадали ни в историю правок, ни
          // в heatmap. Идемпотентность здесь уже обеспечена снаружи (INSERT
          // в offline_sync_log по client_id чуть выше) — свой ключ внутрь
          // не передаём, иначе она сработала бы дважды на одном и том же op.
          if (store_id) {
            const applied=await salesRepo.applySaleUpsert({
              employee_id,
              store_id,
              sale_date,
              metrics,
              source: 'sync',
              clientId: client_id,
              occurredAt: op.created_at,
              createdByTelegramId: request.user!.telegram_id ? Number(request.user!.telegram_id) : null
            });
            deduped=!!applied.deduped;
          }
        }
        // shift_open/shift_close никогда не ставятся в офлайн-очередь —
        // open/close смены всегда бьют в /shifts/open|close напрямую
        // (см. frontend/offline-queue.js: очередь умеет только sale).

        results.push({ client_id, status: deduped ? 'duplicate' : 'applied' });
      } catch (e: any) {
        results.push({ client_id, status: 'rejected', retryable:!(e?.statusCode >=400 && e?.statusCode <500), error: e?.message || 'error' });
      }
    }

    return { ok: true, results };
    }
  );
}
