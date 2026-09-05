/**
 * Внутренний чат (20.57.0) — создание сообщений, идемпотентность,
 * пагинация, CSRF (§31/§32 брифа).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAs as authAsBase, authAsSession } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { hashPassword } from '../../src/auth/password.js';
import * as sessionsRepo from '../../src/data/repositories/sessions.js';
import { query } from '../../src/data/db/index.js';

/** См. chat-attachments.test.ts — POST /chat/messages лимитирован 20/мин
 * по request.ip; этот файл суммарно шлёт под/над этой границей по многим
 * it()-блокам, разведение по синтетическому IP на сотрудника убирает
 * межтестовую гонку за один и тот же bucket. */
function authAs(telegramId: number) {
  const id = Number(telegramId) % 4294967295;
  const ip = `10.${(id >>> 24) & 255}.${(id >>> 8) & 255}.${id & 255}`;
  return { ...authAsBase(telegramId), 'x-forwarded-for': ip };
}

function uniquePhone(): string {
  return '+7906' + Math.floor(1000000 + Math.random() * 8999999);
}

describe('Внутренний чат — сообщения', () => {
  const fx = new TestFixtures();
  const messageIds: string[] = [];

  afterAll(async () => {
    if (messageIds.length) await query(`DELETE FROM chat_messages WHERE id = ANY($1)`, [messageIds]);
    await fx.cleanup();
  });

  it('создаёт текстовое сообщение, автор/время — серверные', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Chat Msg Org');
    const emp = await fx.createEmployee(org, { role: 'employee', fullName: 'Иван Петров' });
    const before = Date.now();
    const res = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAs(emp.telegramId), 'content-type': 'application/json' },
      payload: { clientMessageId: crypto.randomUUID(), body: 'Привет команде' }
    });
    expect(res.statusCode).toBe(200);
    const msg = res.json();
    messageIds.push(msg.id);
    expect(msg.body).toBe('Привет команде');
    expect(msg.sender.id).toBe(emp.id);
    expect(new Date(msg.createdAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('пустое сообщение без вложений — 400', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Chat Empty Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const res = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAs(emp.telegramId), 'content-type': 'application/json' },
      payload: { clientMessageId: crypto.randomUUID(), body: '' }
    });
    expect(res.statusCode).toBe(400);
  });

  it('whitespace-only сообщение без вложений — 400', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Chat Whitespace Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const res = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAs(emp.telegramId), 'content-type': 'application/json' },
      payload: { clientMessageId: crypto.randomUUID(), body: '   \n\t  ' }
    });
    expect(res.statusCode).toBe(400);
  });

  it('сообщение длиннее 5000 символов — 400', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Chat MaxLen Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const res = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAs(emp.telegramId), 'content-type': 'application/json' },
      payload: { clientMessageId: crypto.randomUUID(), body: 'a'.repeat(5001) }
    });
    expect(res.statusCode).toBe(400);
  });

  it('идемпотентный retry — тот же clientMessageId возвращает тот же канонический id, не создаёт вторую строку', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Chat Idem Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const clientMessageId = crypto.randomUUID();

    const first = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAs(emp.telegramId), 'content-type': 'application/json' },
      payload: { clientMessageId, body: 'Retry me' }
    });
    expect(first.statusCode).toBe(200);
    messageIds.push(first.json().id);

    const second = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAs(emp.telegramId), 'content-type': 'application/json' },
      payload: { clientMessageId, body: 'Retry me' }
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);

    const count = await query(`SELECT count(*)::int as n FROM chat_messages WHERE sender_employee_id = $1 AND client_message_id = $2`, [emp.id, clientMessageId]);
    expect(count.rows[0].n).toBe(1);
  });

  it('конкурентные POST с одним clientMessageId — ровно одна строка в БД', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Chat Race Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const clientMessageId = crypto.randomUUID();

    const requests = Array.from({ length: 5 }, () =>
      app.inject({
        method: 'POST',
        url: '/chat/messages',
        headers: { ...authAs(emp.telegramId), 'content-type': 'application/json' },
        payload: { clientMessageId, body: 'race' }
      })
    );
    const results = await Promise.all(requests);
    for (const r of results) expect(r.statusCode).toBe(200);
    const ids = new Set(results.map((r) => r.json().id));
    expect(ids.size).toBe(1);
    messageIds.push([...ids][0] as string);

    const count = await query(`SELECT count(*)::int as n FROM chat_messages WHERE sender_employee_id = $1 AND client_message_id = $2`, [emp.id, clientMessageId]);
    expect(count.rows[0].n).toBe(1);
  });

  it('курсорная пагинация — детерминированный порядок, без дублей/пропусков по двум страницам', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Chat Page Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const created: string[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/chat/messages',
        headers: { ...authAs(emp.telegramId), 'content-type': 'application/json' },
        payload: { clientMessageId: crypto.randomUUID(), body: `msg ${i}` }
      });
      created.push(res.json().id);
      messageIds.push(res.json().id);
    }

    const page1 = await app.inject({ method: 'GET', url: '/chat/messages?limit=3', headers: authAs(emp.telegramId) });
    expect(page1.json().items).toHaveLength(3);
    const cursor = page1.json().nextCursor;
    expect(cursor).toBeTruthy();

    const page2 = await app.inject({ method: 'GET', url: `/chat/messages?limit=10&cursor=${cursor}`, headers: authAs(emp.telegramId) });
    const page1Ids = page1.json().items.map((m: any) => m.id);
    const page2Ids = page2.json().items.map((m: any) => m.id);
    const overlap = page1Ids.filter((id: string) => page2Ids.includes(id));
    expect(overlap).toHaveLength(0);

    const combined = new Set([...page1Ids, ...page2Ids]);
    for (const id of created) expect(combined.has(id)).toBe(true);
  });

  it('after-cursor (catch-up/polling) — возвращает только более новые сообщения, в ASC порядке', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Chat After Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const first = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAs(emp.telegramId), 'content-type': 'application/json' },
      payload: { clientMessageId: crypto.randomUUID(), body: 'first' }
    });
    messageIds.push(first.json().id);

    const second = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAs(emp.telegramId), 'content-type': 'application/json' },
      payload: { clientMessageId: crypto.randomUUID(), body: 'second' }
    });
    messageIds.push(second.json().id);

    const res = await app.inject({ method: 'GET', url: `/chat/messages?after=${first.json().id}`, headers: authAs(emp.telegramId) });
    expect(res.statusCode).toBe(200);
    const items = res.json().items;
    expect(items.map((m: any) => m.id)).toEqual([second.json().id]);
  });

  it('cursor и after одновременно — 400', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Chat Conflict Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const res = await app.inject({ method: 'GET', url: '/chat/messages?cursor=1&after=1', headers: authAs(emp.telegramId) });
    expect(res.statusCode).toBe(400);
  });

  it('default page size <= 50, max <= 100 (limit=500 усекается)', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Chat Limit Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const res = await app.inject({ method: 'GET', url: '/chat/messages?limit=500', headers: authAs(emp.telegramId) });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBeLessThanOrEqual(100);
  });

  // §32 брифа — CSRF та же дисциплина, что и весь остальной backend, без
  // исключения для chat API (browser-сессия, не Telegram).
  it('CSRF: POST /chat/messages через t2_session без X-CSRF-Token — 403', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Chat CSRF Org');
    const passwordHash = await hashPassword('csrf-pass');
    const { id } = await fx.createPhoneEmployee(org, uniquePhone(), passwordHash);
    const token = await sessionsRepo.createSession(id);
    const res = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { cookie: `t2_session=${token}` },
      payload: { clientMessageId: crypto.randomUUID(), body: 'no csrf' }
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('csrf_mismatch');
  });

  it('CSRF: POST /chat/messages через t2_session с валидным X-CSRF-Token — успех', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Chat CSRF OK Org');
    const passwordHash = await hashPassword('csrf-pass');
    const { id } = await fx.createPhoneEmployee(org, uniquePhone(), passwordHash);
    const token = await sessionsRepo.createSession(id);
    const res = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAsSession(token), 'content-type': 'application/json' },
      payload: { clientMessageId: crypto.randomUUID(), body: 'valid csrf' }
    });
    expect(res.statusCode).toBe(200);
    messageIds.push(res.json().id);
  });

  // Регрессия 20.57.1: fetch() без явного Content-Type отправляет тело как
  // text/plain — Fastify не парсит его в объект, TypeBox падает с
  // FST_ERR_VALIDATION, клиент видит "Некорректные данные запроса", хотя
  // JSON-полезная нагрузка валидна. Воспроизводит ровно этот сценарий.
  it('без заголовка Content-Type (тело как text/plain) — 400 validation_failed, "Некорректные данные запроса"', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Chat NoCT Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const res = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAs(emp.telegramId), 'content-type': 'text/plain;charset=UTF-8' },
      payload: JSON.stringify({ clientMessageId: crypto.randomUUID(), body: 'no content-type' })
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_failed');
    expect(res.json().message).toBe('Некорректные данные запроса');
  });

  // 20.57.2 BLOCKER — доказать message delivery semantics, не только
  // Content-Type: ни одна ветка отказа не должна оставлять "ghost" строку
  // в chat_messages — ни на уровне схемы (FST_ERR_VALIDATION), ни на
  // уровне бизнес-валидации (пусто/слишком длинно/слишком много вложений).
  describe('Delivery semantics: отказ (400) НЕ создаёт запись в chat_messages', () => {
    it('schema-level 400 (text/plain Content-Type) — ни одной новой строки в chat_messages', async () => {
      const app = await getApp();
      const org = await fx.createOrg('Chat NoCT Count Org');
      const emp = await fx.createEmployee(org, { role: 'employee' });
      const before = await query(`SELECT count(*)::int as n FROM chat_messages WHERE sender_employee_id = $1`, [emp.id]);
      const res = await app.inject({
        method: 'POST',
        url: '/chat/messages',
        headers: { ...authAs(emp.telegramId), 'content-type': 'text/plain;charset=UTF-8' },
        payload: JSON.stringify({ clientMessageId: crypto.randomUUID(), body: 'ghost check' })
      });
      expect(res.statusCode).toBe(400);
      const after = await query(`SELECT count(*)::int as n FROM chat_messages WHERE sender_employee_id = $1`, [emp.id]);
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });

    it('business-level 400 (пустое сообщение) — транзакция откатывается, ни одной новой строки', async () => {
      const app = await getApp();
      const org = await fx.createOrg('Chat Empty Count Org');
      const emp = await fx.createEmployee(org, { role: 'employee' });
      const before = await query(`SELECT count(*)::int as n FROM chat_messages WHERE sender_employee_id = $1`, [emp.id]);
      const res = await app.inject({
        method: 'POST',
        url: '/chat/messages',
        headers: { ...authAs(emp.telegramId), 'content-type': 'application/json' },
        payload: { clientMessageId: crypto.randomUUID(), body: '' }
      });
      expect(res.statusCode).toBe(400);
      const after = await query(`SELECT count(*)::int as n FROM chat_messages WHERE sender_employee_id = $1`, [emp.id]);
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });
  });

  // 20.57.2 BLOCKER — "потерянный response после реального успеха на
  // сервере": сообщение УЖЕ создано (первый POST), но клиент как будто
  // никогда не получил ответ и делает retry с тем же clientMessageId.
  // Идемпотентность на этом же clientMessageId должна вернуть ТОТ ЖЕ
  // канонический ряд, а не создать вторую "призрачную" строку.
  it('retry после "потерянного" успешного ответа — ровно одна строка, тот же canonical id, тело не изменилось', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Chat LostResponse Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const clientMessageId = crypto.randomUUID();

    // "Сервер принял" — реальный POST, успешно создаёт строку. Frontend
    // в реальном сценарии этот успешный ответ не увидел бы (оборвавшаяся
    // сеть/потерянный response), но по факту сообщение уже в БД.
    const accepted = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAs(emp.telegramId), 'content-type': 'application/json' },
      payload: { clientMessageId, body: 'lost response' }
    });
    expect(accepted.statusCode).toBe(200);
    messageIds.push(accepted.json().id);

    // Retry с тем же clientMessageId — единственный сигнал, который есть у
    // frontend после "неопределённого" исхода.
    const retry = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAs(emp.telegramId), 'content-type': 'application/json' },
      payload: { clientMessageId, body: 'lost response' }
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().id).toBe(accepted.json().id);
    expect(retry.json().body).toBe('lost response');

    const count = await query(`SELECT count(*)::int as n FROM chat_messages WHERE sender_employee_id = $1 AND client_message_id = $2`, [
      emp.id,
      clientMessageId
    ]);
    expect(count.rows[0].n).toBe(1);
  });
});
