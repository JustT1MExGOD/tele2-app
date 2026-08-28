/**
 * Единый auth для v3 + v8
 * employee / manager / admin / supervisor
 *
 * 20.9.0 (Authentication Boundary) — Telegram-специфика (initData/заголовки)
 * и Identity->Principal резолвинг переехали в src/auth/ (providers/telegram.ts,
 * principal.ts); этот файл остаётся Fastify-специфичной обвязкой поверх них
 * (authPlugin, requireAuth/requireActive/…, org-scope декораторы) и
 * ре-экспортирует Role/AccessStatus/AuthUser/ROLE_LEVEL/canAssignRole/loadUser
 * без изменений имён — ~30 роут-файлов уже импортируют их отсюда.
 */
import { FastifyRequest, FastifyReply } from 'fastify';
import * as storesRepo from '../data/repositories/stores.js';
import * as employeesRepo from '../data/repositories/employees.js';
import * as supervisorSectorsRepo from '../data/repositories/supervisor-sectors.js';
import { resolveTelegramIdentity } from './providers/telegram.js';
import { resolvePhoneIdentity } from './providers/phone.js';
import { loadUser } from './principal.js';
import type { AuthUser } from './principal.js';

export type { Role, AccessStatus, AuthUser, Principal } from './principal.js';
export { ROLE_LEVEL, canAssignRole, loadUser } from './principal.js';
export type { Identity, IdentityProvider } from './identity.js';

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

export async function resolveUser(request: FastifyRequest): Promise<AuthUser | null> {
  // Telegram — приоритет (существующее поведение не меняется); не-Telegram
  // вход (20.35, план) — фолбэк на cookie-сессию, только когда Telegram
  // identity отсутствует (гость внутри Telegram без initData не должен
  // случайно подхватить чужую браузерную сессию с того же устройства).
  const identity = resolveTelegramIdentity(request) || (await resolvePhoneIdentity(request));
  if (!identity) return null;
  return loadUser(identity);
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
    if (request.authError === 'phone_expired') {
      reply.code(401).send({ error: 'session_expired', message: 'Сессия истекла, войдите снова.' });
      return false;
    }
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
    if (request.authError === 'phone_expired') {
      reply.code(401).send({ error: 'session_expired', message: 'Сессия истекла, войдите снова.' });
      return false;
    }
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
 * Может ли этот пользователь вносить/синхронизировать ПРОДАЖИ ЗА ДРУГОГО
 * сотрудника? Уже сотрудник заполняет "внести продажу" только за себя —
 * это отдельное, более узкое разрешение, чем общее isManager() (которое
 * включает senior для аналитики/просмотра): senior не входит сюда
 * намеренно, по решению владельца продукта — операционно senior "как
 * manager" почти везде, но не здесь.
 *
 * Единая точка правды для этой конкретной проверки — раньше POST /sales
 * (routes-sales.ts) и POST /sales/quick + /sync/batch (routes-shifts.ts)
 * каждый решали это по-своему (один — inline role-check без senior,
 * другие — через isManager() с senior), т.е. один и тот же вопрос
 * "может ли senior вписать продажу за коллегу" имел два разных ответа в
 * зависимости от того, каким путём продажа попадала в систему.
 */
export function canWriteSalesForOthers(user?: AuthUser | null): boolean {
  return user?.role === 'manager' || user?.role === 'admin';
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