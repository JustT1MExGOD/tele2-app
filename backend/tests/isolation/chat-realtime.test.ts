/**
 * Внутренний чат (20.57.0) — WebSocket realtime (§34 брифа): auth на
 * апгрейде, org-scoped broadcast, cleanup registry, ре-валидация сессии.
 *
 * app.injectWS() (light-my-request) не даёт синтетическому request'у
 * реальный req.socket — с trustProxy:1 (app.ts) это падает внутри pino'вского
 * request-логгера (@fastify/proxy-addr читает req.socket.remoteAddress) ещё
 * до преHandler, апгрейд зависает навсегда (найдено эмпирически). Реальный
 * HTTP-сервер на эфемерном порту + настоящий `ws`-клиент — тот же путь, что
 * прошёл бы браузер, без этого несовместимого с этим app.ts инструментом.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import WebSocket from 'ws';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import { connectionCountForOrg } from '../../src/core/chat/realtime-registry.js';
import { isConnectionStillValid } from '../../src/api/routes/chat/ws.js';

let baseUrl: string;

beforeAll(async () => {
  const app = await getApp();
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = address.replace('http://', 'ws://');
});

function connect(headers: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${baseUrl}/chat/ws`, { headers });
    ws.once('open', () => resolve(ws));
    ws.once('unexpected-response', (_req, res) => reject(new Error(`unexpected-response ${res.statusCode}`)));
    ws.once('error', (e) => reject(e));
  });
}

function waitForMessage(ws: WebSocket, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for ws message')), timeoutMs);
    ws.once('message', (data: Buffer) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

describe('Внутренний чат — realtime (WS)', () => {
  const fx = new TestFixtures();
  const messageIds: string[] = [];

  afterAll(async () => {
    if (messageIds.length) await query(`DELETE FROM chat_messages WHERE id = ANY($1)`, [messageIds]);
    await fx.cleanup();
  });

  it('неаутентифицированный WS-апгрейд отклоняется (не открывается)', async () => {
    await expect(connect({})).rejects.toBeTruthy();
  });

  it('аутентифицированное подключение открывается и регистрируется в scope-registry', async () => {
    const org = await fx.createOrg('WS Connect Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const before = connectionCountForOrg(org);
    const ws = await connect(authAs(emp.telegramId) as Record<string, string>);
    expect(connectionCountForOrg(org)).toBe(before + 1);
    ws.terminate();
  });

  it('disconnect — соединение убирается из registry', async () => {
    const org = await fx.createOrg('WS Disconnect Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const ws = await connect(authAs(emp.telegramId) as Record<string, string>);
    expect(connectionCountForOrg(org)).toBe(1);
    ws.terminate();
    await new Promise((r) => setTimeout(r, 300));
    expect(connectionCountForOrg(org)).toBe(0);
  });

  it('POST сообщения — ровно один broadcast подключённому клиенту своей сети', async () => {
    const app = await getApp();
    const org = await fx.createOrg('WS Broadcast Org');
    const sender = await fx.createEmployee(org, { role: 'employee' });
    const listener = await fx.createEmployee(org, { role: 'employee' });
    const ws = await connect(authAs(listener.telegramId) as Record<string, string>);

    const messagePromise = waitForMessage(ws);
    const res = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAs(sender.telegramId), 'content-type': 'application/json' },
      payload: { clientMessageId: crypto.randomUUID(), body: 'realtime hello' }
    });
    expect(res.statusCode).toBe(200);
    messageIds.push(res.json().id);

    const event = await messagePromise;
    expect(event.type).toBe('message');
    expect(event.message.id).toBe(res.json().id);
    expect(event.message.body).toBe('realtime hello');
    ws.terminate();
  });

  it('сеть B не получает broadcast сети A', async () => {
    const app = await getApp();
    const orgA = await fx.createOrg('WS Isolation Org A');
    const orgB = await fx.createOrg('WS Isolation Org B');
    const senderA = await fx.createEmployee(orgA, { role: 'employee' });
    const listenerB = await fx.createEmployee(orgB, { role: 'employee' });
    const wsB = await connect(authAs(listenerB.telegramId) as Record<string, string>);

    let receivedByB = false;
    wsB.on('message', () => {
      receivedByB = true;
    });

    const res = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAs(senderA.telegramId), 'content-type': 'application/json' },
      payload: { clientMessageId: crypto.randomUUID(), body: 'A-only message' }
    });
    messageIds.push(res.json().id);

    await new Promise((r) => setTimeout(r, 300));
    expect(receivedByB).toBe(false);
    wsB.terminate();
  });

  it('§14: превышение MAX_CONNECTIONS_PER_EMPLOYEE закрывает лишнее соединение', async () => {
    const org = await fx.createOrg('WS TooMany Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const sockets: WebSocket[] = [];
    for (let i = 0; i < 8; i++) {
      sockets.push(await connect(authAs(emp.telegramId) as Record<string, string>));
    }
    const extra = await connect(authAs(emp.telegramId) as Record<string, string>);
    const closeCode = await new Promise<number>((resolve) => extra.once('close', (code) => resolve(code)));
    expect(closeCode).toBe(4008);
    for (const s of sockets) s.terminate();
  });

  it('деактивированный сотрудник — ре-валидация возвращает false (heartbeat закрыл бы соединение)', async () => {
    const org = await fx.createOrg('WS Deactivated Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    expect(await isConnectionStillValid(emp.id, org)).toBe(true);
    await query(`UPDATE employees SET is_active = false WHERE id = $1`, [emp.id]);
    expect(await isConnectionStillValid(emp.id, org)).toBe(false);
  });

  it('сотрудник, переведённый в другую сеть — ре-валидация под старым orgId возвращает false', async () => {
    const orgA = await fx.createOrg('WS Moved Org A');
    const orgB = await fx.createOrg('WS Moved Org B');
    const emp = await fx.createEmployee(orgA, { role: 'employee' });
    expect(await isConnectionStillValid(emp.id, orgA)).toBe(true);
    await query(`UPDATE employees SET org_id = $1 WHERE id = $2`, [orgB, emp.id]);
    expect(await isConnectionStillValid(emp.id, orgA)).toBe(false);
  });
});
