/**
 * Hotfix 20.57.1 PASS 2, finding #1 — RELAY-AWARE CHAT RATE LIMIT.
 *
 * relay/src/forward.ts calls this backend from its own single outbound
 * connection and never forwards the original desktop client's IP (no
 * X-Forwarded-For/X-Real-IP passthrough — by design, see that file). Before
 * this fix, POST/GET /chat/messages and /chat/attachments keyed their
 * per-route @fastify/rate-limit purely on request.ip (see chat-messages.
 * test.ts's authAs() workaround, which had to synthesize a distinct
 * X-Forwarded-For per employee just to stop unrelated tests from tripping
 * each other's IP-keyed bucket) — meaning every employee behind one relay
 * instance would share one quota. employeeAwareKeyGenerator()
 * (security/rate-limit.ts) now keys authenticated requests by employee_id
 * instead. These tests deliberately do NOT set any X-Forwarded-For header —
 * app.inject() gives every request here the exact same apparent IP, which
 * is the whole point: it reproduces "many employees behind one relay IP".
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

function buildMultipart(fieldName: string, filename: string, mime: string, data: Buffer) {
  const boundary = '----t2chatrltest' + Date.now() + Math.random();
  const pre = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`
  );
  const post = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { contentType: `multipart/form-data; boundary=${boundary}`, body: Buffer.concat([pre, data, post]) };
}

const REAL_TXT = Buffer.from('Обычный текстовый файл для чата.');

describe('Chat rate-limit — identity-keyed, not IP-keyed (relay-aware)', () => {
  const fx = new TestFixtures();
  const messageIds: string[] = [];

  afterAll(async () => {
    if (messageIds.length) await query(`DELETE FROM chat_messages WHERE id = ANY($1)`, [messageIds]);
    await fx.cleanup();
  });

  it('employee A и employee B за одним IP имеют независимые quota на POST /chat/messages', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Relay RL Org A');
    const empA = await fx.createEmployee(org, { role: 'employee' });
    const empB = await fx.createEmployee(org, { role: 'employee' });

    // Same apparent IP for both (no X-Forwarded-For at all) — A exhausts
    // its own 20/min quota entirely.
    for (let i = 0; i < 20; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/chat/messages',
        headers: { ...authAs(empA.telegramId), 'content-type': 'application/json' },
        payload: { clientMessageId: crypto.randomUUID(), body: `a-${i}` }
      });
      expect(res.statusCode).toBe(200);
      messageIds.push(res.json().id);
    }
    const aBlocked = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAs(empA.telegramId), 'content-type': 'application/json' },
      payload: { clientMessageId: crypto.randomUUID(), body: 'a-over' }
    });
    expect(aBlocked.statusCode).toBe(429);

    // B, same IP, untouched quota — must still succeed.
    const bRes = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAs(empB.telegramId), 'content-type': 'application/json' },
      payload: { clientMessageId: crypto.randomUUID(), body: 'b-first' }
    });
    expect(bRes.statusCode).toBe(200);
    messageIds.push(bRes.json().id);
  });

  it('один и тот же employee всё ещё ограничивается (20/мин не убрано, просто ключ сменился)', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Relay RL Org Solo');
    const emp = await fx.createEmployee(org, { role: 'employee' });

    let last;
    for (let i = 0; i < 21; i++) {
      last = await app.inject({
        method: 'POST',
        url: '/chat/messages',
        headers: { ...authAs(emp.telegramId), 'content-type': 'application/json' },
        payload: { clientMessageId: crypto.randomUUID(), body: `solo-${i}` }
      });
      if (last.statusCode === 200) messageIds.push(last.json().id);
    }
    expect(last!.statusCode).toBe(429);
  });

  it('unauthenticated (нет валидного X-Telegram-Id) — поведение не изменилось, ключ остаётся по IP', async () => {
    const app = await getApp();
    // No auth headers at all — requireActive() rejects with 401, but the
    // rate-limit hook itself must run first and use the IP fallback path
    // without throwing (proves employeeAwareKeyGenerator's ip-fallback
    // branch is exercised, not just the identity branch).
    const res = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { 'content-type': 'application/json' },
      payload: { clientMessageId: crypto.randomUUID(), body: 'anon' }
    });
    expect(res.statusCode).toBe(401);
  });

  it('employee A и employee B за одним IP имеют независимые quota на POST /chat/attachments', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Relay RL Org Attach');
    const empA = await fx.createEmployee(org, { role: 'employee' });
    const empB = await fx.createEmployee(org, { role: 'employee' });
    const attachmentIds: string[] = [];

    async function upload(telegramId: number) {
      const { contentType, body } = buildMultipart('file', 'x.txt', 'text/plain', REAL_TXT);
      return app.inject({
        method: 'POST',
        url: '/chat/attachments',
        headers: { ...authAs(telegramId), 'content-type': contentType },
        payload: body
      });
    }

    for (let i = 0; i < 15; i++) {
      const res = await upload(empA.telegramId);
      expect(res.statusCode).toBe(200);
      attachmentIds.push(res.json().id);
    }
    const aBlocked = await upload(empA.telegramId);
    expect(aBlocked.statusCode).toBe(429);

    // B, same IP, untouched quota — must still succeed.
    const bRes = await upload(empB.telegramId);
    expect(bRes.statusCode).toBe(200);
    attachmentIds.push(bRes.json().id);

    await query(`DELETE FROM chat_attachment_blobs WHERE storage_key IN (SELECT storage_key FROM chat_attachments WHERE id = ANY($1))`, [attachmentIds]);
    await query(`DELETE FROM chat_attachments WHERE id = ANY($1)`, [attachmentIds]);
  });
});
