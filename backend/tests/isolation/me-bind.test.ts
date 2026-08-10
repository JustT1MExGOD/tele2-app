import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';

// Регрессия на КРИТИЧНУЮ дыру: POST /me/bind был вообще без авторизации —
// telegram_id брался из тела запроса (или спуфабельного заголовка), не из
// подтверждённой Telegram initData. Любой мог отвязать чужой telegram_id
// (в т.ч. admin) от его карточки и привязать свой — полный захват аккаунта
// без единого заголовка авторизации. Найдено при разборе внешнего чеклиста.
describe('Изоляция привязки Telegram (POST /me/bind)', () => {
  const fx = new TestFixtures();
  let orgA: string;
  let admin: { id: number; telegramId: number };
  let unclaimedEmployee: { id: number; telegramId: number };
  const attackerTelegramId = Math.floor(9_000_000_000 + Math.random() * 900_000_000);

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A');
    admin = await fx.createEmployee(orgA, { role: 'admin', fullName: 'Real Admin' });
    unclaimedEmployee = await fx.createEmployee(orgA, { role: 'employee', telegramId: null });
  });

  afterAll(() => fx.cleanup());

  it('без валидной Telegram initData (guest, никакого X-Telegram-Id) — 401', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/me/bind',
      headers: { 'content-type': 'application/json' },
      payload: { employee_id: admin.id }
    });
    expect(res.statusCode).toBe(401);
  });

  it('атакующий не может захватить уже занятую карточку admin своим telegram_id', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/me/bind',
      // ALLOW_INSECURE_AUTH=true в тестах доверяет X-Telegram-Id как есть —
      // это и есть "атакующий", подтверждённый как СВОЙ telegram_id, но
      // пытающийся привязать его к чужой (уже занятой) карточке через body.
      headers: { 'x-telegram-id': String(attackerTelegramId), 'content-type': 'application/json' },
      payload: { employee_id: admin.id, telegram_id: admin.telegramId }
    });
    expect(res.statusCode).toBe(409);
  });

  it('admin.telegram_id в БД не изменился после попытки захвата', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { 'x-telegram-id': String(admin.telegramId) }
    });
    const body = res.json();
    expect(body.bound).toBe(true);
    expect(body.full_name).toBe('Real Admin');
  });

  it('привязка к НЕзанятой карточке своим же telegram_id — проходит', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/me/bind',
      headers: { 'x-telegram-id': String(attackerTelegramId), 'content-type': 'application/json' },
      payload: { employee_id: unclaimedEmployee.id }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Number(body.telegram_id)).toBe(attackerTelegramId);
  });
});
