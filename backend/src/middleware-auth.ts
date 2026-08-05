/**
 * Единый auth для v3 + v8
 * employee / manager / admin / supervisor
 */
import { FastifyRequest, FastifyReply } from 'fastify';
import { query } from './db/index.js';
import { verifyTelegramInitData } from './services/telegram-auth.js';

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

  const res = await query(
    `SELECT id as employee_id, full_name, role, telegram_id, access_status, is_active, org_id
     FROM employees
     WHERE telegram_id = $1::bigint
     LIMIT 1`,
    [telegramId]
  );

  if (!res.rows[0]) {
    return {
      telegram_id: telegramId,
      employee_id: null,
      full_name: null,
      role: 'guest',
      access_status: 'none',
      org_id: 'default'
    };
  }

  const e = res.rows[0];
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
    // на голый заголовок, иначе проверка теряет смысл.
    return null;
  }

  if (!botToken || insecureDev) {
    const raw =
      (request.headers['x-telegram-id'] as string) ||
      (request.headers['x-telegram-user-id'] as string) ||
      '';
    if (raw) return Number(raw);
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
}

export function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user?.employee_id) {
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
      const res = await query(
        `SELECT s.id as store_id
         FROM supervisor_sectors ss
         JOIN organizations o ON o.sector_id = ss.sector_id
         JOIN stores s ON COALESCE(s.org_id, 'default') = o.id
         WHERE ss.supervisor_id = $1`,
        [user.employee_id]
      );
      return res.rows.map((r: any) => r.store_id);
    } catch {
      return [];
    }
  }
  return [];
}