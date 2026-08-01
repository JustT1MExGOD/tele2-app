/**
 * Единый auth (v8)
 * Замени им ЭТИМ файлом: src/middleware-auth.ts
 * Удали middleware-auth-v8.ts и везде импортируй из './middleware-auth.js'
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { query } from './db/index.js';

export type Role = 'employee' | 'manager' | 'supervisor' | 'admin' | 'guest';
export type AccessStatus = 'pending' | 'active' | 'rejected' | 'blocked' | 'none';

export type AppUser = {
  telegram_id: number;
  employee_id: number | null;
  full_name: string | null;
  role: Role;
  access_status: AccessStatus;
};

/** @deprecated alias — для старых импортов AuthUser */
export type AuthUser = AppUser;

declare module 'fastify' {
  interface FastifyRequest {
    user?: AppUser | null;
  }
}

export async function loadUser(telegramId: number): Promise<AppUser> {
  const res = await query(
    `SELECT id, full_name, role, access_status, telegram_id
     FROM employees
     WHERE telegram_id = $1
     LIMIT 1`,
    [telegramId]
  );
  if (!res.rows[0]) {
    return {
      telegram_id: telegramId,
      employee_id: null,
      full_name: null,
      role: 'guest',
      access_status: 'none'
    };
  }
  const e = res.rows[0];
  return {
    telegram_id: telegramId,
    employee_id: Number(e.id),
    full_name: e.full_name,
    role: (e.role || 'employee') as Role,
    access_status: (e.access_status || 'active') as AccessStatus
  };
}

/** Старое имя — совместимость */
export async function resolveUser(request: FastifyRequest): Promise<AppUser | null> {
  const telegramId =
    (request.headers['x-telegram-id'] as string) ||
    (request.headers['x-telegram-user-id'] as string) ||
    '';
  if (!telegramId) return null;
  const user = await loadUser(Number(telegramId));
  if (user.access_status === 'none') return null;
  return user;
}

export async function authPlugin(request: FastifyRequest, _reply: FastifyReply) {
  const raw =
    (request.headers['x-telegram-id'] as string) ||
    (request.headers['x-telegram-user-id'] as string) ||
    (request.query as any)?.telegram_id;
  if (!raw) {
    request.user = null;
    return;
  }
  request.user = await loadUser(Number(raw));
}

export function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user || !request.user.employee_id) {
    reply.code(401).send({
      error: 'unauthorized',
      message: 'Привяжите Telegram в разделе «Мой»'
    });
    return false;
  }
  return true;
}

/** Полный доступ только active */
export function requireActive(request: FastifyRequest, reply: FastifyReply) {
  const u = request.user;
  if (!u || u.access_status === 'none') {
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
  const role = request.user?.role;
  if (role !== 'manager' && role !== 'admin') {
    reply.code(403).send({ error: 'forbidden', message: 'Только для управляющего' });
    return false;
  }
  return true;
}

export function requireManagerOrSupervisor(request: FastifyRequest, reply: FastifyReply) {
  if (!requireActive(request, reply)) return false;
  const role = request.user?.role;
  if (role !== 'manager' && role !== 'admin' && role !== 'supervisor') {
    reply.code(403).send({ error: 'manager or supervisor only' });
    return false;
  }
  return true;
}

export function requireSupervisor(request: FastifyRequest, reply: FastifyReply) {
  if (!requireActive(request, reply)) return false;
  const role = request.user?.role;
  if (role !== 'supervisor' && role !== 'admin' && role !== 'manager') {
    reply.code(403).send({ error: 'supervisor only' });
    return false;
  }
  return true;
}

export function isManager(user?: AppUser | null) {
  return user?.role === 'manager' || user?.role === 'admin';
}

/** null = все точки (manager/admin); [] = нет; string[] = точки супервайзера */
export async function getUserStoreIds(user: AppUser): Promise<string[] | null> {
  if (!user.employee_id) return [];
  if (user.role === 'manager' || user.role === 'admin') return null;
  if (user.role === 'supervisor') {
    const res = await query(
      `SELECT store_id FROM supervisor_stores WHERE supervisor_id = $1`,
      [user.employee_id]
    );
    return res.rows.map((r: any) => r.store_id);
  }
  return [];
}
