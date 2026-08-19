import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';

/**
 * Изначально три роута (/me/day, /access/status, /me/access) читали
 * X-Telegram-Id заголовок НАПРЯМУЮ (`request.headers['x-telegram-id']`),
 * а не через authPlugin/resolveUser — единственный путь, реально
 * проверяющий подпись Telegram initData (verifyTelegramInitData). Даже в
 * "боевом" режиме (BOT_TOKEN задан, ALLOW_INSECURE_AUTH выключен) эти три
 * роута доверяли голому заголовку так же, как в небезопасном dev-режиме —
 * любой внешний вызывающий, зная чужой telegram_id, читал чужие
 * продажи/график/задачи/роль/org_id без единой действительной подписи.
 *
 * Починено (routes-me.ts, routes-v8.ts): все три роута теперь читают
 * identity ИСКЛЮЧИТЕЛЬНО из request.user, который проставляет глобальный
 * authPlugin (preHandler, app.ts) и который уже подтверждён подписью
 * initData в "боевом" режиме. Заодно чинится input-validation дыра
 * (см. input-validation.test.ts) — /me/day больше не парсит telegram_id
 * из query/заголовка вообще, так что дробные/переполняющие значения там
 * больше не могут ничего уронить.
 */
describe('AUTH BYPASS (ПОЧИНЕНО): /me/day, /access/status, /me/access больше не доверяют голому X-Telegram-Id в обход подписи', () => {
  const fx = new TestFixtures();
  let orgVictim: string;
  let victim: { id: number; telegramId: number };
  let origBotToken: string | undefined;
  let origInsecure: string | undefined;

  beforeAll(async () => {
    orgVictim = await fx.createOrg('Victim Org');
    victim = await fx.createEmployee(orgVictim, { role: 'manager', fullName: 'Victim Manager' });

    // Симулируем "боевой" режим: BOT_TOKEN задан, insecure dev-фоллбэк
    // выключен — единственный легитимный путь авторизации теперь
    // подписанный initData, которого атакующий не имеет.
    origBotToken = process.env.BOT_TOKEN;
    origInsecure = process.env.ALLOW_INSECURE_AUTH;
    process.env.BOT_TOKEN = 'adversarial-test-fake-bot-token';
    process.env.ALLOW_INSECURE_AUTH = 'false';
  });

  afterAll(async () => {
    // Обязательно восстановить — иначе все остальные тесты в прогоне
    // (authAs() везде полагается на ALLOW_INSECURE_AUTH=true) начнут
    // ловить 401 пачками.
    if (origBotToken === undefined) delete process.env.BOT_TOKEN;
    else process.env.BOT_TOKEN = origBotToken;
    if (origInsecure === undefined) delete process.env.ALLOW_INSECURE_AUTH;
    else process.env.ALLOW_INSECURE_AUTH = origInsecure;
    await fx.cleanup();
  });

  it('control: GET /me с голым заголовком в "боевом" режиме НЕ идентифицирует пользователя (не менялось)', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { 'x-telegram-id': String(victim.telegramId) }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.bound).toBe(false);
  });

  it('ПОЧИНЕНО: GET /me/day с чужим telegram_id в заголовке БОЛЬШЕ НЕ отдаёт приватные данные жертвы', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/me/day',
      headers: { 'x-telegram-id': String(victim.telegramId) }
    });
    // Без подтверждённого request.user роут теперь отвечает bound:false —
    // тот же безопасный паттерн, что у /me.
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.bound).toBe(false);
    expect(body.employee?.full_name).toBeUndefined();
  });

  it('ПОЧИНЕНО: GET /me/day через ?telegram_id= query-параметр тоже больше не работает', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/me/day?telegram_id=${victim.telegramId}`
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.bound).toBe(false);
  });

  it('ПОЧИНЕНО: GET /access/status с чужим telegram_id БОЛЬШЕ НЕ отдаёт role/org_id/access_status/employee_id жертвы', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/access/status',
      headers: { 'x-telegram-id': String(victim.telegramId) }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Без подтверждённой подписи — анонимно, не "active"-статус жертвы.
    expect(body.status).toBe('anonymous');
    expect(body.user).toBeUndefined();
  });

  it('ПОЧИНЕНО: GET /me/access с чужим telegram_id БОЛЬШЕ НЕ отдаёт AuthUser-запись жертвы', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/me/access',
      headers: { 'x-telegram-id': String(victim.telegramId) }
    });
    // Нет подтверждённой identity вовсе — 401, не 200 с чужими данными.
    expect(res.statusCode).toBe(401);
  });

  it('ПОЧИНЕНО: /me/day?telegram_id=123.456 больше не крашит сервер — идёт через request.user, малформленный query-параметр никогда не парсится', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/me/day?telegram_id=123.456' });
    expect(res.statusCode).toBe(200);
    expect(res.json().bound).toBe(false);
  });
});
