/**
 * Идентичность и привязка Telegram: /me, /me/bind, /me/day (смена+факт+
 * дневной план сегодня), назначение роли. Выделено из routes-v3.ts.
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { isManager } from '../../../auth/guards.js';
import { hashPassword } from '../../../auth/password.js';
import { todayMoscow } from '../../../utils/date.js';
import { normalizePhone } from '../../../utils/phone.js';
import { withTransaction } from '../../../data/db/index.js';
import * as employeesRepo from '../../../data/repositories/employees.js';
import * as schedulesRepo from '../../../data/repositories/schedules.js';
import * as salesRepo from '../../../data/repositories/sales.js';
import * as plansRepo from '../../../data/repositories/plans.js';
import * as tasksRepo from '../../../data/repositories/tasks.js';
import type { MeResponse, BindMeResponse, MeDayResponse, LinkPhoneResponse } from '../../../shared/api-types.js';

const MeBindBody = Type.Object({
  employee_id: Type.Number()
});
type MeBindBody = Static<typeof MeBindBody>;

const LinkPhoneBody = Type.Object({
  phone: Type.String({ minLength: 7, maxLength: 16 }),
  password: Type.String({ minLength: 8, maxLength: 200 })
});
type LinkPhoneBody = Static<typeof LinkPhoneBody>;

export async function registerMeRoutes(app: FastifyInstance) {
  // ========== ME / ROLE ==========
  app.get('/me', async (request, reply): Promise<MeResponse> => {
    // не 404 — фронту удобнее: bound:false → показать «Привязать»
    if (!request.user?.employee_id) {
      return {
        bound: false,
        employee_id: null,
        full_name: null,
        role: null,
        telegram_id: request.headers['x-telegram-id'] || null
      };
    }
    // Не-Telegram вход (20.36) — нужно фронту, чтобы решить, показывать
    // ли «Привязать телефон» или «Уже подключено: +7…». Отдельный запрос,
    // не поле Principal — эта информация нужна только здесь, раздувать
    // AuthUser (используется в ~30 файлах) ради одного экрана не стоит.
    const phone = await employeesRepo.getPhone(request.user.employee_id).catch(() => null);
    return {
      bound: true,
      employee_id: request.user.employee_id,
      id: request.user.employee_id,
      full_name: request.user.full_name,
      role: request.user.role,
      telegram_id: request.user.telegram_id,
      is_manager: isManager(request.user),
      org_id: request.user.org_id,
      phone
    };
  });

  // Не-Telegram вход (20.36) — уже авторизованный через Telegram сотрудник
  // добавляет телефон+пароль к СВОЕЙ карточке как второй способ входа.
  // В отличие от POST /auth/register (открытая самостоятельная регистрация
  // для тех, у кого ещё нет аккаунта) — здесь identity уже подтверждена
  // (request.user), approve через access_requests не нужен, пишем сразу.
  app.post(
    '/me/link-phone',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { body: LinkPhoneBody } },
    async (request, reply): Promise<LinkPhoneResponse | FastifyReply> => {
      if (!request.user?.employee_id) {
        return reply.code(401).send({ error: 'unauthorized', message: 'Войдите через Telegram' });
      }
      const b = request.body as LinkPhoneBody;
      const phone = normalizePhone(String(b.phone || ''));
      if (!phone) {
        return reply.code(400).send({ error: 'invalid_phone', message: 'Некорректный номер телефона' });
      }

      const passwordHash = await hashPassword(b.password);
      try {
        await withTransaction((q) => employeesRepo.setPhoneAndPassword(request.user!.employee_id!, phone, passwordHash, q));
      } catch (e: any) {
        if (e?.code === '23505') {
          return reply.code(409).send({ error: 'phone_taken', message: 'Этот номер уже привязан к другому аккаунту' });
        }
        throw e;
      }
      return { ok: true };
    }
  );

  app.post(
    '/me/bind',
    { schema: { body: MeBindBody } },
    async (request, reply): Promise<BindMeResponse | FastifyReply> => {
    // Раньше telegram_id брался из тела запроса (или вообще из спуфабельного
    // заголовка) — любой мог отвязать чужой telegram_id от его карточки и
    // привязать СВОЙ к произвольному employee_id, включая admin. Полный
    // захват аккаунта, без какой-либо авторизации. telegram_id теперь
    // ТОЛЬКО из request.user (подтверждён подписью Telegram initData в
    // authPlugin) — populated даже для гостя без employee_id, так что
    // ранний self-bind по-прежнему работает.
    const telegram_id = Number(request.user?.telegram_id || 0);
    if (!telegram_id) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Telegram initData не подтверждён' });
    }
    const body = request.body as MeBindBody;
    const employee_id = Number(body?.employee_id);
    if (!employee_id) {
      return reply.code(400).send({ error: 'employee_id required' });
    }

    // Карточка должна быть либо ещё не привязана, либо уже привязана к
    // ЭТОМУ ЖЕ telegram_id (идемпотентный повтор) — иначе это захват уже
    // занятой карточки чужого сотрудника (в т.ч. admin) со своим telegram_id.
    const target = await employeesRepo.findBindTarget(employee_id);
    if (!target) {
      return reply.code(404).send({ error: 'employee not found' });
    }
    // GET /employees (единственный источник списка карточек для бинда во
    // фронте) уже фильтрует is_active=true — но сам /me/bind принимает
    // employee_id из тела запроса без проверки, а UPDATE ниже раньше сам же
    // ставил is_active=true на любую карточку. Уволенный/маленький
    // последовательный id легко угадать — без этой проверки кто угодно мог
    // руками (в обход фронта) привязать свой Telegram к карточке
    // ДЕАКТИВИРОВАННОГО сотрудника и унаследовать всю его историю продаж/
    // BFQ/XP — реактивация карточки должна быть осознанным действием
    // менеджера (PATCH /employees/:id), а не побочным эффектом self-bind.
    if (target.is_active === false) {
      return reply.code(409).send({
        error: 'employee_inactive',
        message: 'Карточка деактивирована. Обратитесь к менеджеру для восстановления доступа'
      });
    }
    const currentOwner = target.telegram_id ? Number(target.telegram_id) : null;
    if (currentOwner && currentOwner !== telegram_id) {
      return reply.code(409).send({ error: 'already_bound', message: 'Карточка уже привязана к другому Telegram' });
    }

    // снять tg с других карточек и привязать к выбранной — одним атомарным
    // запросом (claimTelegramId), не двумя отдельными: между SELECT-чеком
    // выше и этой операцией всё ещё есть узкое окно гонки при нескольких
    // одновременных bind на один telegram_id, но employees.telegram_id
    // UNIQUE (0002) — единственный источник правды "кто победил", проигравший
    // запрос падает по constraint, а не молча портит данные — ловим это
    // здесь и отдаём тот же понятный 409, а не голую ошибку SQL.
    let bound: any;
    try {
      bound = await withTransaction((q) => employeesRepo.claimTelegramId(telegram_id, employee_id, q));
    } catch (e: any) {
      if (e?.code === '23505') {
        return reply.code(409).send({ error: 'already_bound', message: 'Карточка уже привязана к другому Telegram' });
      }
      throw e;
    }
    if (!bound) {
      return reply.code(404).send({ error: 'employee not found' });
    }
    return { bound: true, ...bound };
    }
  );

  /** Мой день: смена + факт + дневной план */
  app.get('/me/day', async (request, reply): Promise<MeDayResponse> => {
    const date = String((request.query as any)?.date || todayMoscow()).slice(0, 10);

    // Раньше identity бралась из голого X-Telegram-Id заголовка/?telegram_id=
    // query-параметра — в обход authPlugin/verifyTelegramInitData, то есть
    // без единой проверки подписи. Любой внешний вызывающий, знающий чужой
    // telegram_id, читал чужой факт/график/задачи. request.user уже
    // проставлен глобальным preHandler (authPlugin, app.ts) и подтверждён
    // подписью Telegram initData — единственный источник identity здесь,
    // как и у /me выше.
    if (!request.user?.employee_id) {
      return { bound: false, message: 'Привяжите аккаунт во вкладке Профиль' };
    }

    const e = await employeesRepo.findBasicActive(request.user.employee_id);
    if (!e) {
      return { bound: false, message: 'Привяжите аккаунт во вкладке Профиль' };
    }

    const shift = await schedulesRepo.findShiftWithStore(e.id, date);

    const fact = await salesRepo.sumDayFactForEmployee(e.id, date);

    const month = date.slice(0, 7) + '-01';
    const monthPlan = await plansRepo.findEmployeeMonthPlanExact(e.id, month);

    // факт с начала месяца (для «остаток плана»)
    const mf = await salesRepo.sumMonthFactForEmployee(e.id, month);

    // сколько смен осталось с сегодня до конца месяца
    const remShifts = await schedulesRepo.countRemainingInMonth(e.id, date, month);
    const div = Math.max(1, remShifts);

    const metrics = [
      'sim', 'mnp', 'pa', 'combo', 'phones',
      'accessories', 'settings', 'insurance', 'wink', 'shpd', 'focus'
    ] as const;

    // daily_plan = ceil( (месячный_план − факт_месяца) / оставшиеся_смены )
    const dailyPlan: Record<string, number> = {};
    const progress: Record<string, { fact: number; plan: number; pct: number }> = {};

    for (const m of metrics) {
      const left = Math.max(0, Number(monthPlan?.[m] || 0) - Number(mf[m] || 0));
      dailyPlan[m] = Math.ceil(left / div);

      const f = Number(fact[m]) || 0;
      const p = dailyPlan[m];
      progress[m] = {
        fact: f,
        plan: p,
        pct: p > 0 ? Math.round((f / p) * 100) : f > 0 ? 100 : 0
      };
    }

    const totalFact = metrics.reduce((s, m) => s + (Number(fact[m]) || 0), 0);
    const totalPlan = metrics.reduce((s, m) => s + (dailyPlan[m] || 0), 0);

    // Незакрытые задачи (18.4) — «Мой день» уже единственный персональный
    // экран сотрудника, естественное место показать, что назначил менеджер.
    const tasks = await tasksRepo.findOpenForAssignee(e.id).catch(() => [] as any[]);

    return {
      bound: true,
      employee: e,
      date,
      shift,
      fact,
      daily_plan: dailyPlan,
      progress,
      total: {
        fact: totalFact,
        plan: totalPlan,
        pct: totalPlan > 0 ? Math.round((totalFact / totalPlan) * 100) : 0
      },
      month_plan: monthPlan,
      month_fact: mf,
      remaining_shifts: div,
      tasks
    };
  });

  // Назначение роли живёт в PATCH /employees/:id/role (api/routes/org/employees.ts) —
  // этот POST-дубликат (v3) не вызывается фронтендом (setRole() шлёт PATCH) и
  // не проверял принадлежность сотрудника сети; удалён вместо починки
  // неиспользуемой копии.

  // Удобный /me с access — слито из routes-v8.ts (20.11.0, репо-реструктуризация).
  app.get('/me/access', async (request, reply) => {
    if (!request.user?.telegram_id) return reply.code(401).send({ error: 'no telegram id' });
    return request.user;
  });
}
