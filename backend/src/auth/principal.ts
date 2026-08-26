/**
 * 20.9.0 — Principal: кем система считает текущего авторизованного
 * пользователя, после того как Identity подтверждена конкретным
 * provider'ом (сегодня только Telegram, см. providers/telegram.ts).
 *
 * AuthUser — то же самое, что Principal; имя сохранено ради обратной
 * совместимости с ~30 файлами, которые уже импортируют его из
 * middleware-auth.ts (который теперь просто ре-экспортирует всё отсюда).
 * Не переименовано и не убрано намеренно — 20.9.0 создаёт границу, а не
 * ломает существующий код ради чистоты имени (см. README §22).
 */
import * as employeesRepo from '../data/repositories/employees.js';
import type { Identity } from './identity.js';

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

/** Principal — то же самое, что AuthUser; используйте это имя в новом коде. */
export type Principal = AuthUser;

function emptyUser(identity: Identity): AuthUser {
  return {
    telegram_id: identity.provider === 'telegram' ? Number(identity.providerId) || 0 : 0,
    employee_id: null,
    full_name: null,
    role: 'guest',
    access_status: 'none',
    org_id: 'default'
  };
}

function principalFromRow(e: Awaited<ReturnType<typeof employeesRepo.findByTelegramId>>, fallbackTelegramId: number): AuthUser {
  const active = e!.is_active !== false;
  return {
    telegram_id: Number(e!.telegram_id) || fallbackTelegramId,
    employee_id: active ? Number(e!.employee_id) : null,
    full_name: e!.full_name,
    role: (e!.role || 'employee') as Role,
    access_status: (e!.access_status || (active ? 'active' : 'none')) as AccessStatus,
    org_id: e!.org_id || 'default'
  };
}

/**
 * Identity -> Principal. Два provider'а сегодня: Telegram (lookup по
 * telegram_id) и phone (20.35, план — не-Telegram вход; сессия уже
 * резолвила конкретный employee_id, providerId — он самим, не внешний id).
 * При появлении третьего provider'а здесь просто добавится ещё одна ветка,
 * а не отдельная копия authPlugin/requireAuth/etc. в каждом adapter'е.
 */
export async function loadUser(identity: Identity): Promise<AuthUser> {
  if (identity.provider === 'phone') {
    const employeeId = Number(identity.providerId);
    if (!employeeId) return emptyUser(identity);
    const e = await employeesRepo.findById(employeeId);
    if (!e) return emptyUser(identity);
    return principalFromRow(e, 0);
  }

  if (identity.provider !== 'telegram') return emptyUser(identity);

  const telegramId = Number(identity.providerId);
  if (!telegramId) return emptyUser(identity);

  const e = await employeesRepo.findByTelegramId(telegramId);
  if (!e) return emptyUser(identity);

  return principalFromRow(e, telegramId);
}
