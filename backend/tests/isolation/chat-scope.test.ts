/**
 * Внутренний чат (20.57.0) — org-scope изоляция (§30 брифа). Тот же
 * паттерн, что announcements-channels.test.ts: две сети, проверяем, что ни
 * чтение, ни запись, ни realtime не пересекают границу org_id.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

describe('Внутренний чат — org-scope изоляция', () => {
  const fx = new TestFixtures();
  const messageIds: string[] = [];
  const attachmentIds: string[] = [];

  afterAll(async () => {
    if (attachmentIds.length) {
      await query(`DELETE FROM chat_attachment_blobs WHERE storage_key IN (SELECT storage_key FROM chat_attachments WHERE id = ANY($1))`, [attachmentIds]);
      await query(`DELETE FROM chat_attachments WHERE id = ANY($1)`, [attachmentIds]);
    }
    if (messageIds.length) {
      await query(`DELETE FROM chat_attachments WHERE message_id = ANY($1)`, [messageIds]);
      await query(`DELETE FROM chat_messages WHERE id = ANY($1)`, [messageIds]);
    }
    await fx.cleanup();
  });

  async function postMessage(app: any, telegramId: number, body: string, extra: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAs(telegramId), 'content-type': 'application/json' },
      payload: { clientMessageId: crypto.randomUUID(), body, ...extra }
    });
    if (res.statusCode === 200) messageIds.push(res.json().id);
    return res;
  }

  it('unauthenticated GET /chat/messages — 401', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/chat/messages' });
    expect(res.statusCode).toBe(401);
  });

  it('unauthenticated POST /chat/messages — 401', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      payload: { clientMessageId: crypto.randomUUID(), body: 'hi' }
    });
    expect(res.statusCode).toBe(401);
  });

  it('inactive employee — 401/403, не 200', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Chat Inactive Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    await query(`UPDATE employees SET is_active = false WHERE id = $1`, [emp.id]);
    const res = await app.inject({ method: 'GET', url: '/chat/messages', headers: authAs(emp.telegramId) });
    expect(res.statusCode).not.toBe(200);
  });

  it('employee сети A читает свои сообщения; сеть B не видит их', async () => {
    const app = await getApp();
    const orgA = await fx.createOrg('Chat Org A');
    const orgB = await fx.createOrg('Chat Org B');
    const empA = await fx.createEmployee(orgA, { role: 'employee' });
    const empB = await fx.createEmployee(orgB, { role: 'employee' });

    const created = await postMessage(app, empA.telegramId, 'Сообщение сети A');
    expect(created.statusCode).toBe(200);
    const createdId = created.json().id;

    const listA = await app.inject({ method: 'GET', url: '/chat/messages', headers: authAs(empA.telegramId) });
    expect(listA.statusCode).toBe(200);
    expect(listA.json().items.some((m: any) => m.id === createdId)).toBe(true);

    const listB = await app.inject({ method: 'GET', url: '/chat/messages', headers: authAs(empB.telegramId) });
    expect(listB.statusCode).toBe(200);
    expect(listB.json().items.some((m: any) => m.id === createdId)).toBe(false);
  });

  it('renderer не может подделать sender — POST от employee всегда создаёт сообщение от него самого', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Chat Sender Org');
    const empA = await fx.createEmployee(org, { role: 'employee', fullName: 'Настоящий отправитель' });
    const empB = await fx.createEmployee(org, { role: 'employee', fullName: 'Чужое имя' });

    const res = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAs(empA.telegramId), 'content-type': 'application/json' },
      // Тело пытается указать чужого отправителя — поля просто не существуют
      // в PostMessageBody-схеме, но даже если бы существовали, backend их
      // не читает вообще (см. core/chat/service.ts).
      payload: {
        clientMessageId: crypto.randomUUID(),
        body: 'Кто я на самом деле?',
        senderUserId: empB.id,
        senderName: 'Чужое имя',
        senderRole: 'admin'
      }
    });
    expect(res.statusCode).toBe(200);
    messageIds.push(res.json().id);
    expect(res.json().sender.id).toBe(empA.id);
    expect(res.json().sender.displayName).not.toBe('Чужое имя');
  });

  it('forged organizationId в теле POST игнорируется — сообщение остаётся в своей сети', async () => {
    const app = await getApp();
    const orgA = await fx.createOrg('Chat Forge Org A');
    const orgB = await fx.createOrg('Chat Forge Org B');
    const empA = await fx.createEmployee(orgA, { role: 'employee' });
    const empB = await fx.createEmployee(orgB, { role: 'employee' });

    const res = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAs(empA.telegramId), 'content-type': 'application/json' },
      payload: { clientMessageId: crypto.randomUUID(), body: 'Подделка сети', org_id: orgB, organizationId: orgB }
    });
    expect(res.statusCode).toBe(200);
    messageIds.push(res.json().id);

    const listB = await app.inject({ method: 'GET', url: '/chat/messages', headers: authAs(empB.telegramId) });
    expect(listB.json().items.some((m: any) => m.id === res.json().id)).toBe(false);

    const listA = await app.inject({ method: 'GET', url: '/chat/messages', headers: authAs(empA.telegramId) });
    expect(listA.json().items.some((m: any) => m.id === res.json().id)).toBe(true);
  });

  it('B не может получить сообщение A по прямому cursor-обходу (только собственная сеть в выдаче)', async () => {
    const app = await getApp();
    const orgA = await fx.createOrg('Chat Cursor Org A');
    const orgB = await fx.createOrg('Chat Cursor Org B');
    const empA = await fx.createEmployee(orgA, { role: 'employee' });
    const empB = await fx.createEmployee(orgB, { role: 'employee' });

    const created = await postMessage(app, empA.telegramId, 'Приватное сообщение A');
    const targetId = created.json().id;

    // Курсор чуть выше искомого id — если бы scope не проверялся, B увидел бы его.
    const res = await app.inject({
      method: 'GET',
      url: `/chat/messages?cursor=${Number(targetId) + 1}&limit=50`,
      headers: authAs(empB.telegramId)
    });
    expect(res.json().items.some((m: any) => m.id === targetId)).toBe(false);
  });
});
