/**
 * Единый auth для v3 + v8
 * employee / manager / admin / supervisor
 */
import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyTelegramInitData } from './services/telegram-auth.js';
import * as storesRepo from './repositories/stores.js';
import * as employeesRepo from './repositories/employees.js';
import * as supervisorSectorsRepo from './repositories/supervisor-sectors.js';

export type Role = 'trainee' | 'employee' | 'senior' | 'manager' | 'supervisor' | 'admin' | 'guest';
export type AccessStatus = 'pending' | 'active' | 'rejected' | 'blocked' | 'none';

/**
 * Иерархия ролей: trainee < employee < senior < manager < supervisor < admin.
 * senior — операционно то же самое, что manager (проходит requireManager),
 * но не видит Command Center и кабинет супервайзера (см. canViewSupervisor
 * в routes-supervisor.ts и canViewAnalytics() на фронте — туда senior
 * намеренно не добавлен).
 */
export const ROLE_LEVEL: Record<Role, number> = {
  guest: -1,
  trainee: 0,
  employee: 1,
  senior: 2,
  manager: 3,
  supervisor: 4,
  admin: 5
};

/** Можно назначать только роли строго ниже своей; admin — без ограничений. */
export function canAssignRole(actorRole: Role, targetRole: Role): boolean {
  if (actorRole === 'admin') return true;
  return ROLE_LEVEL[targetRole] < ROLE_LEVEL[actorRole];
}

export interface AuthUser {
  telegram_id: string | number;
  employee_id: number | null;
  full_name: string | null;
  role: Role;
  access_status: AccessStatus;
  /** Сеть точек (organizations.id) сотрудника — 'default', пока у него не задана. */
  org_id: string;
}


/** Alias для v8 */
export type AppUser = AuthUser;

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser | null;
    /** Причина, по которой user остался null — 'expired' даёт понятное
     * сообщение вместо голого 401 (см. requireAuth/requireActive). */
    authError?: string | null;
  }
}

export async function loadUser(telegramId: number): Promise<AuthUser> {
  if (!telegramId) {
    return {
      telegram_id: 0,
      employee_id: null,
      full_name: null,
      role: 'guest',
      access_status: 'none',
      org_id: 'default'
    };
  }

  const e = await employeesRepo.findByTelegramId(telegramId);

  if (!e) {
    return {
      telegram_id: telegramId,
      employee_id: null,
      full_name: null,
      role: 'guest',
      access_status: 'none',
      org_id: 'default'
    };
  }

  const active = e.is_active !== false;
  return {
    telegram_id: Number(e.telegram_id) || telegramId,
    employee_id: active ? Number(e.employee_id) : null,
    full_name: e.full_name,
    role: (e.role || 'employee') as Role,
    access_status: (e.access_status || (active ? 'active' : 'none')) as AccessStatus,
    org_id: e.org_id || 'default'
  };
}

/**
 * telegram_id доверяем ТОЛЬКО если он подтверждён подписью Telegram
 * (initData). Голый заголовок X-Telegram-Id легко подделать, поэтому
 * он используется лишь как dev-фоллбэк, когда BOT_TOKEN не настроен
 * (локальная разработка) или явно включён ALLOW_INSECURE_AUTH=true.
 */
function resolveTelegramId(request: FastifyRequest): number | null {
  const botToken = process.env.BOT_TOKEN || '';
  const insecureDev = process.env.ALLOW_INSECURE_AUTH === 'true';
  const initData =
    (request.headers['x-telegram-init-data'] as string) ||
    (request.headers['x-telegram-initdata'] as string) ||
    '';

  if (initData && botToken) {
    const verified = verifyTelegramInitData(initData, botToken);
    if (verified.ok && verified.user?.id) {
      return verified.user.id;
    }
    // initData присутствует, но не проходит проверку — не откатываемся
    // на голый заголовок, иначе проверка теряет смысл. reason прокидываем
    // на request, чтобы requireAuth/requireActive могли ответить понятнее
    // голого 401 — особенно для 'expired' (переоткрыть Mini App чинит это).
    request.authError = verified.reason || 'invalid';
    return null;
  }

  if (!botToken || insecureDev) {
    const raw =
      (request.headers['x-telegram-id'] as string) ||
      (request.headers['x-telegram-user-id'] as string) ||
      '';
    // Голый Number(raw) пропускал дробные ("123.456") и переполняющие
    // bigint значения ("1e+29" в экспоненциальной записи) как "валидные" —
    // они падали только позже, на ::bigint в SQL, необработанным
    // исключением (500) на любом роуте, читающем request.user. Реальные
    // Telegram id — целые положительные числа, максимум ~15 цифр с
    // огромным запасом.
    if (raw && /^\d{1,15}$/.test(raw)) return Number(raw);
    return null;
  }

  return null;
}

export async function resolveUser(request: FastifyRequest): Promise<AuthUser | null> {
  const telegramId = resolveTelegramId(request);
  if (!telegramId) return null;
  return loadUser(telegramId);
}

export async function authPlugin(request: FastifyRequest, _reply: FastifyReply) {
  // Хук вешается в нескольких route-модулях; выполняем резолв один раз.
  if (request.user !== undefined) return;
  request.user = await resolveUser(request);
  // employee_id/org_id на все последующие log-строки этого запроса — без
  // этого разбор инцидента по логам Railway сводится к тому, чтобы грепать
  // reqId и вручную сопоставлять его с БД, лишь бы понять, чей это был запрос.
  if (request.user?.employee_id) {
    request.log = request.log.child({ employee_id: request.user.employee_id, org_id: request.user.org_id });
  }
}

export function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user?.employee_id) {
    if (request.authError === 'expired') {
      reply.code(401).send({
        error: 'session_expired',
        message: 'Сессия истекла. Переоткройте Mini App через Telegram.'
      });
      return false;
    }
    reply.code(401).send({
      error: 'unauthorized',
      message: 'Привяжите Telegram в разделе «Мой»'
    });
    return false;
  }
  return true;
}

export function requireActive(request: FastifyRequest, reply: FastifyReply) {
  const u = request.user;
  if (!u || u.access_status === 'none' || !u.employee_id) {
    if (request.authError === 'expired') {
      reply.code(401).send({
        error: 'session_expired',
        message: 'Сессия истекла. Переоткройте Mini App через Telegram.'
      });
      return false;
    }
    reply.code(401).send({
      error: 'not_registered',
      message: 'Нужна регистрация. Отправьте заявку на доступ.'
    });
    return false;
  }
  if (u.access_status === 'pending') {
    reply.code(403).send({
      error: 'pending',
      message: 'Заявка на проверке у manager / супервайзера.'
    });
    return false;
  }
  if (u.access_status === 'rejected' || u.access_status === 'blocked') {
    reply.code(403).send({
      error: u.access_status,
      message: 'Доступ закрыт. Обратитесь к управляющему.'
    });
    return false;
  }
  return true;
}

export function requireManager(request: FastifyRequest, reply: FastifyReply) {
  if (!requireActive(request, reply)) return false;
  const role = request.user!.role;
  if (role !== 'manager' && role !== 'admin' && role !== 'senior') {
    reply.code(403).send({ error: 'forbidden', message: 'Только для управляющего' });
    return false;
  }
  return true;
}

export function requireManagerOrSupervisor(request: FastifyRequest, reply: FastifyReply) {
  if (!requireActive(request, reply)) return false;
  const role = request.user!.role;
  if (role !== 'manager' && role !== 'admin' && role !== 'supervisor' && role !== 'senior') {
    reply.code(403).send({ error: 'manager or supervisor only' });
    return false;
  }
  return true;
}

export function requireSupervisor(request: FastifyRequest, reply: FastifyReply) {
  if (!requireActive(request, reply)) return false;
  const role = request.user!.role;
  if (role !== 'supervisor' && role !== 'admin' && role !== 'manager' && role !== 'senior') {
    reply.code(403).send({ error: 'supervisor only' });
    return false;
  }
  return true;
}

/**
 * Сеть, в разрезе которой сейчас смотрим данные (Команда/График/Касса/Промокоды):
 * своя по умолчанию; admin может явно затребовать другую сеть (переключатель
 * сети в UI шлёт org_id параметром/полем тела) — все остальные роли override игнорируют.
 */
export function resolveViewOrgId(user: AuthUser, override?: string | null): string {
  return user.role === 'admin' && override ? override : user.org_id;
}

/**
 * Точка принадлежит указанной сети? Один и тот же чек раньше был
 * продублирован дословно в нескольких роутах (POST /schedules,
 * PUT /plans/stores/:id/month) — каждый писал свой SELECT store.org_id.
 */
export async function assertStoreInOrg(storeId: string, orgId: string): Promise<boolean> {
  try {
    // 19.22.0 (Data Access Layer): делегирует в repositories/stores.ts —
    // сигнатура/имя не меняются (декоратор requireStoreInOrg ниже и 5
    // fetch-then-check роутов зовут именно эту функцию), меняется только
    // то, что доступ к stores теперь идёт через один репозиторий, а не
    // через свой SELECT здесь же.
    return await storesRepo.belongsToOrg(orgId, storeId);
  } catch {
    return false;
  }
}

/** Сотрудник принадлежит указанной сети? Тот же паттерн, что assertStoreInOrg —
 * нужен там, где по чужому employee_id можно достучаться до BFQ/анкет/etc. */
export async function assertEmployeeInOrg(employeeId: number, orgId: string): Promise<boolean> {
  try {
    // 20.8.0 (Full DAL): делегирует в repositories/employees.ts — та же
    // причина, что assertStoreInOrg → storesRepo.belongsToOrg (19.22.0).
    return await employeesRepo.belongsToOrg(orgId, employeeId);
  } catch {
    return false;
  }
}

type ParamSource = 'params' | 'body' | 'query';

function readField(request: FastifyRequest, source: ParamSource, field: string): unknown {
  const bag = (source === 'params' ? request.params : source === 'body' ? request.body : request.query) as any;
  return bag?.[field];
}

/** org_id для сравнения — своя сеть по умолчанию, override (тело/query)
 * учитывается только если явно разрешён и звонящий admin (см. resolveViewOrgId). */
function resolveDecoratorOrgId(request: FastifyRequest, allowOrgOverride: boolean | undefined): string {
  const override = allowOrgOverride
    ? ((request.body as any)?.org_id ?? (request.query as any)?.org_id)
    : undefined;
  return resolveViewOrgId(request.user!, override);
}

/** Декоратору достаточно, чтобы request.user вообще существовал (чтобы
 * безопасно прочитать .org_id/.role) — КАКОЙ именно уровень доступа
 * (requireAuth/requireActive/requireManager/canView...) нужен для самого
 * роута, решает и проверяет сам роут, как и раньше; декоратор в эту
 * логику не лезет, только добавляет проверку сети поверх неё. */
function requireUserPresent(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!request.user) {
    reply.code(401).send({ error: 'unauthorized', message: 'Привяжите Telegram' });
    return false;
  }
  return true;
}

/**
 * preHandler-декоратор для assertStoreInOrg — то же самое, что ручной
 * `if (!(await assertStoreInOrg(...))) return reply.code(403)...`,
 * но регистрируется в опциях роута, а значит не может быть случайно забыт
 * в новом обработчике (именно так были упущены дыры, закрытые в 19.11.0).
 *
 * НЕ подходит там, где store_id узнаётся только после fetch внутри самого
 * обработчика (например «чья была эта продажа») — на этапе preHandler id
 * ещё не известен, ручной assertStoreInOrg там остаётся правильным
 * инструментом. Не подходит и для проверки внутри цикла по массиву
 * операций (bulk/batch-роуты) — там каждый элемент проверяется отдельно.
 */
export function requireStoreInOrg(
  source: ParamSource,
  field: string,
  opts: { allowOrgOverride?: boolean; optional?: boolean } = {}
) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    if (!requireUserPresent(request, reply)) return;
    const storeId = readField(request, source, field);
    if (!storeId) {
      if (opts.optional) return;
      reply.code(400).send({ error: 'store_id_required' });
      return;
    }
    const orgId = resolveDecoratorOrgId(request, opts.allowOrgOverride);
    if (!(await assertStoreInOrg(String(storeId), orgId))) {
      reply.code(403).send({ error: 'forbidden', message: 'Точка не принадлежит вашей сети' });
    }
  };
}

/** Тот же декоратор, но для assertEmployeeInOrg — см. requireStoreInOrg. */
export function requireEmployeeInOrg(source: ParamSource, field: string, opts: { allowOrgOverride?: boolean } = {}) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    if (!requireUserPresent(request, reply)) return;
    const raw = readField(request, source, field);
    const employeeId = Number(raw);
    if (!raw || !Number.isFinite(employeeId)) {
      reply.code(400).send({ error: 'employee_id_required' });
      return;
    }
    const orgId = resolveDecoratorOrgId(request, opts.allowOrgOverride);
    if (!(await assertEmployeeInOrg(employeeId, orgId))) {
      reply.code(403).send({ error: 'forbidden', message: 'Сотрудник не принадлежит вашей сети' });
    }
  };
}

export function isManager(user?: AuthUser | null) {
  return user?.role === 'manager' || user?.role === 'admin' || user?.role === 'senior';
}

/**
 * Точки, видимые пользователю. manager/admin — без ограничений (null).
 * supervisor — руководитель сектора: видит все точки всех сетей своего
 * сектора (supervisor_sectors → organizations → stores), а не список
 * отдельных точек — назначение теперь на уровне сектора целиком.
 */
export async function getUserStoreIds(user: AuthUser): Promise<string[] | null> {
  if (!user.employee_id) return [];
  if (user.role === 'manager' || user.role === 'admin' || user.role === 'senior') return null;
  if (user.role === 'supervisor') {
    try {
      return await supervisorSectorsRepo.listStoreIdsForSupervisor(user.employee_id);
    } catch {
      return [];
    }
  }
  return [];
}