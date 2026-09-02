/**
 * Внутренний чат (T2 Sales backend, 20.57.0) — relay acceptance (§36
 * брифа). Тот же mocked-forwardToUpstream integration-паттерн, что уже
 * есть в relay-integration.test.ts (relay в принципе не знает о
 * конкретных путях/бизнес-логике upstream — эти тесты доказывают, что
 * ИМЕННО ТЕ заголовки/тело, которые нужны chat REST API, реально
 * survive relay boundary, не то, что relay пришлось бы менять под чат).
 *
 * WS через RELAY сознательно НЕ тестируется здесь — relay/src/index.ts
 * реализует единственный маршрут `POST /forward` (request/response),
 * upgrade-обработчика вообще нет; см. итоговый отчёт чата, раздел H —
 * WS-транспорт в RELAY-режиме и не должен работать, фронтенд откатывается
 * на polling (тот же /chat/messages?after=, через этот же relay path).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

async function freshApp(env: Record<string, string> = {}) {
  process.env.RELAY_UPSTREAM_ORIGIN = 'https://upstream.invalid';
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  vi.resetModules();
  const { buildRelay } = await import('../src/index.js');
  return buildRelay();
}

describe('relay /forward — внутренний чат: GET/POST /chat/messages survive relay boundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /chat/messages — cookie (t2_session) доходит до forwardToUpstream, ответ (canonical JSON) доходит до клиента', async () => {
    const forwardSpy = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: Buffer.from(JSON.stringify({ items: [{ id: '1', body: 'hi' }], nextCursor: null }))
    });
    vi.doMock('../src/forward.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/forward.js')>();
      return { ...actual, forwardToUpstream: forwardSpy };
    });
    const app = await freshApp();

    const res = await app.inject({
      method: 'POST',
      url: '/forward',
      headers: {
        'x-t2-method': 'GET',
        'x-t2-path': '/chat/messages?limit=50',
        'x-t2-had-origin': 'false',
        cookie: 't2_session=abc123'
      }
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ items: [{ id: '1', body: 'hi' }], nextCursor: null });
    const forwardedHeaders = forwardSpy.mock.calls[0][0].clientHeaders as Headers;
    expect(forwardedHeaders.get('cookie')).toBe('t2_session=abc123');
    expect(forwardSpy.mock.calls[0][0].path).toBe('/chat/messages?limit=50');
    await app.close();
  });

  it('POST /chat/messages — cookie + X-CSRF-Token + JSON body (client_message_id/body) доходят целиком', async () => {
    const forwardSpy = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: Buffer.from(JSON.stringify({ id: '99', body: 'через relay' }))
    });
    vi.doMock('../src/forward.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/forward.js')>();
      return { ...actual, forwardToUpstream: forwardSpy };
    });
    const app = await freshApp();

    const payload = JSON.stringify({ clientMessageId: '11111111-1111-1111-1111-111111111111', body: 'через relay' });
    const res = await app.inject({
      method: 'POST',
      url: '/forward',
      headers: {
        'x-t2-method': 'POST',
        'x-t2-path': '/chat/messages',
        'x-t2-had-origin': 'true',
        cookie: 't2_session=abc123; t2_csrf=xyz',
        'x-csrf-token': 'xyz',
        'content-type': 'application/json'
      },
      payload
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ id: '99', body: 'через relay' });
    const call = forwardSpy.mock.calls[0][0];
    expect((call.clientHeaders as Headers).get('x-csrf-token')).toBe('xyz');
    expect((call.clientHeaders as Headers).get('content-type')).toBe('application/json');
    expect(call.body.toString('utf8')).toBe(payload);
    await app.close();
  });

  it('POST /chat/attachments — multipart body (произвольные байты, boundary в Content-Type) проходит byte-for-byte', async () => {
    const forwardSpy = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: Buffer.from(JSON.stringify({ id: '7', originalFilename: 'a.txt' }))
    });
    vi.doMock('../src/forward.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/forward.js')>();
      return { ...actual, forwardToUpstream: forwardSpy };
    });
    const app = await freshApp();

    const boundary = '----relaytest';
    const multipartBody = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--${boundary}--\r\n`
    );
    const res = await app.inject({
      method: 'POST',
      url: '/forward',
      headers: {
        'x-t2-method': 'POST',
        'x-t2-path': '/chat/attachments',
        'x-t2-had-origin': 'true',
        cookie: 't2_session=abc123; t2_csrf=xyz',
        'x-csrf-token': 'xyz',
        'content-type': `multipart/form-data; boundary=${boundary}`
      },
      payload: multipartBody
    });

    expect(res.statusCode).toBe(200);
    const call = forwardSpy.mock.calls[0][0];
    expect((call.clientHeaders as Headers).get('content-type')).toBe(`multipart/form-data; boundary=${boundary}`);
    expect(Buffer.compare(call.body, multipartBody)).toBe(0);
    await app.close();
  });

  it('GET /chat/attachments/:id — бинарный ответ (Content-Disposition/Content-Type) доходит до клиента без потери байт', async () => {
    const fileBytes = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5]);
    const forwardSpy = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg', 'content-disposition': 'attachment; filename="photo.jpg"' }),
      body: fileBytes
    });
    vi.doMock('../src/forward.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/forward.js')>();
      return { ...actual, forwardToUpstream: forwardSpy };
    });
    const app = await freshApp();

    const res = await app.inject({
      method: 'POST',
      url: '/forward',
      headers: { 'x-t2-method': 'GET', 'x-t2-path': '/chat/attachments/7', 'x-t2-had-origin': 'false', cookie: 't2_session=abc123' }
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['content-disposition']).toBe('attachment; filename="photo.jpg"');
    expect(Buffer.compare(res.rawPayload, fileBytes)).toBe(0);
    await app.close();
  });

  it('GET /chat/ws — WS-upgrade через relay структурно невозможен: сервер не слушает upgrade вообще (только POST /forward)', async () => {
    const app = await freshApp();
    // Обычный GET на /chat/ws без Upgrade-заголовков просто не находит роут
    // (relay реализует только POST /forward + GET /healthz) — 404, не 101.
    const res = await app.inject({ method: 'GET', url: '/chat/ws' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
