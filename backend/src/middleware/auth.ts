/**
 * Роли и доступ
 * employee  — свои продажи, свой план, просмотр
 * manager   — всё employee + график, VMR/штрафы, экспорт, чужие продажи
 * admin     — как manager (можно расширить)
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db/index.js';

export type Role = 'employee' | 'manager' | 'admin';

export interface AuthUser {
  telegram_id: string;
  employee_id: number;
  full_name: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser | null;
  }
}

export async function resolveUser(request: FastifyRequest): Promise<AuthUser | null> {
  const telegramId =
    (request.headers['x-telegram-id'] as string) ||
    (request.headers['x-telegram-user-id'] as string) ||
    '';

  if (!telegramId) return null;

  const res = await query(
    `SELECT id as employee_id, full_name, role, telegram_id
     FROM employees
     WHERE telegram_id = $1 AND is_active = true
     LIMIT 1`,
    [telegramId]
  );

  if (!res.rows[0]) return null;

  return {
    telegram_id: String(res.rows[0].telegram_id),
    employee_id: Number(res.rows[0].employee_id),
    full_name: res.rows[0].full_name,
    role: (res.rows[0].role || 'employee') as Role
  };
}

/** Подключать early: request.user = await resolveUser(request) */
export async function authPlugin(request: FastifyRequest, _reply: FastifyReply) {
  request.user = await resolveUser(request);
}

export function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) {
    reply.code(401).send({ error: 'unauthorized', message: 'Привяжите Telegram в разделе «Мой»' });
    return false;
  }
  return true;
}

export function requireManager(request: FastifyRequest, reply: FastifyReply) {
  if (!requireAuth(request, reply)) return false;
  const role = request.user!.role;
  if (role !== 'manager' && role !== 'admin') {
    reply.code(403).send({ error: 'forbidden', message: 'Только для управляющего' });
    return false;
  }
  return true;
}

export function isManager(user?: AuthUser | null) {
  return user?.role === 'manager' || user?.role === 'admin';
}
