/**
 * 20.9.0 (Authentication Boundary) — подтверждает саму границу: остальная
 * авторизация (canAssignRole/isManager/ROLE_LEVEL) работает по Principal.role
 * и не знает про Telegram, а loadUser() диспетчеризует по Identity.provider,
 * не по глобальному "мы же всегда Telegram" предположению.
 */
import { describe, it, expect } from 'vitest';
import { canAssignRole, isManager, ROLE_LEVEL, loadUser, type AuthUser } from '../../src/auth/guards.js';
import { resolveTelegramIdentity } from '../../src/auth/providers/telegram.js';
import type { Identity } from '../../src/auth/identity.js';

function principal(role: AuthUser['role']): AuthUser {
  return {
    telegram_id: 1,
    employee_id: 1,
    full_name: 'Test',
    role,
    access_status: 'active',
    org_id: 'default'
  };
}

describe('auth boundary — авторизация не завязана на конкретный provider', () => {
  it('canAssignRole/isManager/ROLE_LEVEL решают по Principal.role — сигнатуры не принимают Identity вообще', () => {
    // AuthUser (Principal) с 20.9.0 не несёт identity — авторизационные
    // примитивы физически не могут заглянуть в "откуда пришёл" пользователь.
    const p = principal('manager');
    expect(isManager(p)).toBe(true);
    expect(ROLE_LEVEL[p.role]).toBe(3);
    expect(canAssignRole(p.role, 'employee')).toBe(true);
    expect(canAssignRole(p.role, 'admin')).toBe(false);
  });

  it('loadUser() с неизвестным provider возвращает guest, не обращаясь к Telegram-специфичному lookup', async () => {
    // 'unknown' здесь — гипотетический будущий provider (as Identity обходит
    // строгую типизацию IdentityProvider намеренно, ради этой проверки) —
    // подтверждает, что диспетчеризация реальна, а не "везде считаем Telegram".
    const identity = { provider: 'unknown', providerId: '42' } as unknown as Identity;
    const u = await loadUser(identity);
    expect(u.role).toBe('guest');
    expect(u.employee_id).toBeNull();
    expect(u.telegram_id).toBe(0);
  });
});

describe('resolveTelegramIdentity — Telegram-специфика изолирована в adapter', () => {
  it('без initData и без заголовка — null, без сайд-эффектов', () => {
    const request: any = { headers: {} };
    expect(resolveTelegramIdentity(request)).toBeNull();
    expect(request.authError).toBeUndefined();
  });

  it('insecure dev (нет BOT_TOKEN) — X-Telegram-Id даёт Identity{provider:"telegram"}', () => {
    const prevToken = process.env.BOT_TOKEN;
    delete process.env.BOT_TOKEN;
    try {
      const request: any = { headers: { 'x-telegram-id': '123456' } };
      expect(resolveTelegramIdentity(request)).toEqual({ provider: 'telegram', providerId: '123456' });
    } finally {
      if (prevToken !== undefined) process.env.BOT_TOKEN = prevToken;
    }
  });

  it('невалидный X-Telegram-Id (не целое число) — null', () => {
    const prevToken = process.env.BOT_TOKEN;
    delete process.env.BOT_TOKEN;
    try {
      const request: any = { headers: { 'x-telegram-id': '123.456' } };
      expect(resolveTelegramIdentity(request)).toBeNull();
    } finally {
      if (prevToken !== undefined) process.env.BOT_TOKEN = prevToken;
    }
  });
});
