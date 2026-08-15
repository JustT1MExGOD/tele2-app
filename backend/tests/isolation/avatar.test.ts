import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';

/** Собираем multipart/form-data вручную — app.inject() принимает сырой Buffer,
 * а @fastify/multipart разбирает его так же, как настоящий HTTP-запрос. */
function buildMultipart(fieldName: string, filename: string, mime: string, data: Buffer) {
  const boundary = '----t2test' + Date.now();
  const pre = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`
  );
  const post = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat([pre, data, post])
  };
}

describe('batch 3, п.19 — кастомная аватарка', () => {
  const fx = new TestFixtures();
  let orgId: string;
  let employee: { id: number; telegramId: number };

  beforeAll(async () => {
    orgId = await fx.createOrg('Org Avatar');
    employee = await fx.createEmployee(orgId, { role: 'employee' });
  });

  afterAll(() => fx.cleanup());

  it('GET /avatars/:id — 404, если аватарка не загружена', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: `/avatars/${employee.id}` });
    expect(res.statusCode).toBe(404);
  });

  it('POST /me/avatar + GET /avatars/:id — round-trip', async () => {
    const app = await getApp();
    // Не настоящий JPEG — байты для теста, endpoint не парсит содержимое,
    // только сохраняет buffer + mimetype как есть.
    const fakeImage = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
    const { contentType, body } = buildMultipart('file', 'avatar.jpg', 'image/jpeg', fakeImage);

    const upload = await app.inject({
      method: 'POST',
      url: '/me/avatar',
      headers: { ...authAs(employee.telegramId), 'content-type': contentType },
      payload: body
    });
    expect(upload.statusCode).toBe(200);

    const res = await app.inject({ method: 'GET', url: `/avatars/${employee.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(Buffer.compare(res.rawPayload, fakeImage)).toBe(0);
  });

  it('POST /me/avatar без привязанного employee_id — 401', async () => {
    const app = await getApp();
    const fakeImage = Buffer.from([1, 2, 3]);
    const { contentType, body } = buildMultipart('file', 'a.jpg', 'image/jpeg', fakeImage);
    const res = await app.inject({
      method: 'POST',
      url: '/me/avatar',
      headers: { 'x-telegram-id': '999999999999', 'content-type': contentType },
      payload: body
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /me/avatar с не-картинкой — 400', async () => {
    const app = await getApp();
    const { contentType, body } = buildMultipart('file', 'a.txt', 'text/plain', Buffer.from('hello'));
    const res = await app.inject({
      method: 'POST',
      url: '/me/avatar',
      headers: { ...authAs(employee.telegramId), 'content-type': contentType },
      payload: body
    });
    expect(res.statusCode).toBe(400);
  });
});
