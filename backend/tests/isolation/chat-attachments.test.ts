/**
 * Внутренний чат (20.57.0) — вложения: валидация типа, лимиты, IDOR-
 * граница, orphan cleanup (§33 брифа).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAs as authAsBase } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import { sweepExpiredChatAttachments } from '../../src/cron/chat-attachment-cleanup.js';
import { hashPassword } from '../../src/auth/password.js';
import * as sessionsRepo from '../../src/data/repositories/sessions.js';

/** app.ts::rateLimit ключует по request.ip (trustProxy: 1 — уважает
 * X-Forwarded-For одного хопа); этот файл намеренно бьёт по /chat/
 * attachments и /chat/messages МНОГО раз в разных it()-блоках — без
 * разведения по синтетическому IP на каждого тестового сотрудника все они
 * делили бы один и тот же bucket и настоящий rate-limit валил бы поздние
 * тесты 429'ми (найдено эмпирически при первом реальном прогоне). */
function authAs(telegramId: number) {
  const id = Number(telegramId) % 4294967295;
  const ip = `10.${(id >>> 24) & 255}.${(id >>> 8) & 255}.${id & 255}`;
  return { ...authAsBase(telegramId), 'x-forwarded-for': ip };
}

function buildMultipart(fieldName: string, filename: string, mime: string, data: Buffer) {
  const boundary = '----t2chattest' + Date.now() + Math.random();
  const pre = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`
  );
  const post = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { contentType: `multipart/form-data; boundary=${boundary}`, body: Buffer.concat([pre, data, post]) };
}

const REAL_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('fake jpeg payload padding padding')]);
const REAL_PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake png payload')]);
const REAL_PDF = Buffer.from('%PDF-1.4\n%fake pdf content for test\n');
const REAL_TXT = Buffer.from('Обычный текстовый файл для чата.');
const REAL_DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('word/document.xml fake ooxml padding')]);
const REAL_XLSX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('xl/workbook.xml fake ooxml padding')]);

describe('Внутренний чат — вложения', () => {
  const fx = new TestFixtures();
  const attachmentIds: string[] = [];
  const messageIds: string[] = [];

  afterAll(async () => {
    if (attachmentIds.length) {
      await query(`DELETE FROM chat_attachment_blobs WHERE storage_key IN (SELECT storage_key FROM chat_attachments WHERE id = ANY($1))`, [attachmentIds]);
      await query(`DELETE FROM chat_attachments WHERE id = ANY($1)`, [attachmentIds]);
    }
    if (messageIds.length) await query(`DELETE FROM chat_messages WHERE id = ANY($1)`, [messageIds]);
    await fx.cleanup();
  });

  async function upload(app: any, telegramId: number, filename: string, mime: string, data: Buffer) {
    const { contentType, body } = buildMultipart('file', filename, mime, data);
    return app.inject({
      method: 'POST',
      url: '/chat/attachments',
      headers: { ...authAs(telegramId), 'content-type': contentType },
      payload: body
    });
  }

  it('разрешённые типы проходят: JPEG/PNG/PDF/TXT/DOCX/XLSX', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Attach OK Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const cases: [string, string, Buffer][] = [
      ['photo.jpg', 'image/jpeg', REAL_JPEG],
      ['photo.png', 'image/png', REAL_PNG],
      ['doc.pdf', 'application/pdf', REAL_PDF],
      ['notes.txt', 'text/plain', REAL_TXT],
      ['report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', REAL_DOCX],
      ['sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', REAL_XLSX]
    ];
    for (const [filename, mime, data] of cases) {
      const res = await upload(app, emp.telegramId, filename, mime, data);
      expect(res.statusCode, `${filename} should be accepted`).toBe(200);
      attachmentIds.push(res.json().id);
    }
  });

  it('>20MB — отклонён', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Attach TooBig Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const big = Buffer.alloc(21 * 1024 * 1024, 0x41);
    const res = await upload(app, emp.telegramId, 'big.txt', 'text/plain', big);
    expect(res.statusCode).not.toBe(200);
  });

  it('исполняемый файл (.exe) — отклонён вне зависимости от содержимого', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Attach Exe Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const res = await upload(app, emp.telegramId, 'virus.exe', 'application/octet-stream', REAL_JPEG);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('dangerous_type');
  });

  it('extension/MIME mismatch (PNG-байты под именем .jpg) — отклонён', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Attach Mismatch Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const res = await upload(app, emp.telegramId, 'fake.jpg', 'image/jpeg', REAL_PNG);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('extension_mime_mismatch');
  });

  it('ZIP (не docx/xlsx) — отклонён', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Attach Zip Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('not office content at all')]);
    const res = await upload(app, emp.telegramId, 'archive.zip', 'application/zip', zip);
    expect(res.statusCode).toBe(400);
  });

  it('traversal filename — сохраняется только последний сегмент, без ../', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Attach Traversal Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const res = await upload(app, emp.telegramId, '../../etc/evil.txt', 'text/plain', REAL_TXT);
    expect(res.statusCode).toBe(200);
    attachmentIds.push(res.json().id);
    expect(res.json().originalFilename).not.toContain('..');
    expect(res.json().originalFilename).not.toContain('/');
    expect(res.json().originalFilename).toBe('evil.txt');
  });

  it('Unicode filename — принимается и сохраняется как есть', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Attach Unicode Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const res = await upload(app, emp.telegramId, 'отчёт_смена.txt', 'text/plain', REAL_TXT);
    expect(res.statusCode).toBe(200);
    attachmentIds.push(res.json().id);
    expect(res.json().originalFilename).toBe('отчёт_смена.txt');
  });

  it('одинаковое имя файла у двух разных загрузок — оба успешны, разные id', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Attach Dup Name Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const first = await upload(app, emp.telegramId, 'same.txt', 'text/plain', REAL_TXT);
    const second = await upload(app, emp.telegramId, 'same.txt', 'text/plain', REAL_TXT);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().id).not.toBe(second.json().id);
    attachmentIds.push(first.json().id, second.json().id);
  });

  it('>5 вложений на сообщение — отклонено', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Attach TooMany Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await upload(app, emp.telegramId, `f${i}.txt`, 'text/plain', REAL_TXT);
      ids.push(res.json().id);
      attachmentIds.push(res.json().id);
    }
    const res = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAs(emp.telegramId), 'content-type': 'application/json' },
      payload: { clientMessageId: crypto.randomUUID(), body: 'too many', attachmentIds: ids }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('too_many_attachments');
  });

  it('полный флоу: upload → POST message с attachmentId → вложение появляется в каноническом сообщении', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Attach Flow Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const up = await upload(app, emp.telegramId, 'flow.pdf', 'application/pdf', REAL_PDF);
    attachmentIds.push(up.json().id);

    const res = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAs(emp.telegramId), 'content-type': 'application/json' },
      payload: { clientMessageId: crypto.randomUUID(), body: null, attachmentIds: [up.json().id] }
    });
    expect(res.statusCode).toBe(200);
    messageIds.push(res.json().id);
    expect(res.json().attachments).toHaveLength(1);
    expect(res.json().attachments[0].id).toBe(up.json().id);
  });

  it('скачивание: авторизованный сотрудник своей сети получает вложение уже отправленного сообщения', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Attach Download Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const up = await upload(app, emp.telegramId, 'dl.txt', 'text/plain', REAL_TXT);
    attachmentIds.push(up.json().id);
    const msg = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAs(emp.telegramId), 'content-type': 'application/json' },
      payload: { clientMessageId: crypto.randomUUID(), body: null, attachmentIds: [up.json().id] }
    });
    messageIds.push(msg.json().id);

    const res = await app.inject({ method: 'GET', url: `/chat/attachments/${up.json().id}`, headers: authAs(emp.telegramId) });
    expect(res.statusCode).toBe(200);
    expect(Buffer.compare(res.rawPayload, REAL_TXT)).toBe(0);
  });

  it('IDOR: сотрудник сети B не может скачать вложение сети A, даже зная id', async () => {
    const app = await getApp();
    const orgA = await fx.createOrg('Attach IDOR Org A');
    const orgB = await fx.createOrg('Attach IDOR Org B');
    const empA = await fx.createEmployee(orgA, { role: 'employee' });
    const empB = await fx.createEmployee(orgB, { role: 'employee' });
    const up = await upload(app, empA.telegramId, 'secret.txt', 'text/plain', REAL_TXT);
    attachmentIds.push(up.json().id);
    const msg = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAs(empA.telegramId), 'content-type': 'application/json' },
      payload: { clientMessageId: crypto.randomUUID(), body: null, attachmentIds: [up.json().id] }
    });
    messageIds.push(msg.json().id);

    const res = await app.inject({ method: 'GET', url: `/chat/attachments/${up.json().id}`, headers: authAs(empB.telegramId) });
    expect(res.statusCode).toBe(404);
  });

  it('prepared (ещё не отправленное) вложение недоступно другому сотруднику той же сети', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Attach Prepared Org');
    const empA = await fx.createEmployee(org, { role: 'employee' });
    const empB = await fx.createEmployee(org, { role: 'employee' });
    const up = await upload(app, empA.telegramId, 'draft.txt', 'text/plain', REAL_TXT);
    attachmentIds.push(up.json().id);

    const res = await app.inject({ method: 'GET', url: `/chat/attachments/${up.json().id}`, headers: authAs(empB.telegramId) });
    expect(res.statusCode).toBe(404);
  });

  // Hotfix 20.57.1 PASS 2, finding #3 — раньше чужое вложение молча
  // отфильтровывалось и сообщение всё равно создавалось (body-only, без
  // единого вложения) — отправитель не узнавал, что вложение не долетело.
  // Теперь весь запрос отклоняется целиком (fail-closed), сообщение НЕ
  // создаётся вообще.
  it('чужое (foreign) вложение — весь запрос отклонён, сообщение НЕ создаётся (fail-closed)', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Attach Ownership Org');
    const empA = await fx.createEmployee(org, { role: 'employee' });
    const empB = await fx.createEmployee(org, { role: 'employee' });
    const up = await upload(app, empA.telegramId, 'not-yours.txt', 'text/plain', REAL_TXT);
    attachmentIds.push(up.json().id);
    const clientMessageId = crypto.randomUUID();

    const res = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAs(empB.telegramId), 'content-type': 'application/json' },
      payload: { clientMessageId, body: 'угнать чужое вложение', attachmentIds: [up.json().id] }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_attachment');
    const check = await query(`SELECT 1 FROM chat_messages WHERE client_message_id = $1`, [clientMessageId]);
    expect(check.rows).toHaveLength(0);
  });

  it('валидное + чужое (foreign) вложение вперемешку — весь запрос отклонён, ни одно вложение не привязывается', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Attach Mixed Foreign Org');
    const empA = await fx.createEmployee(org, { role: 'employee' });
    const empB = await fx.createEmployee(org, { role: 'employee' });
    const foreign = await upload(app, empA.telegramId, 'foreign.txt', 'text/plain', REAL_TXT);
    const own = await upload(app, empB.telegramId, 'own.txt', 'text/plain', REAL_TXT);
    attachmentIds.push(foreign.json().id, own.json().id);
    const clientMessageId = crypto.randomUUID();

    const res = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAs(empB.telegramId), 'content-type': 'application/json' },
      payload: { clientMessageId, body: 'mixed', attachmentIds: [own.json().id, foreign.json().id] }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_attachment');
    const check = await query(`SELECT 1 FROM chat_messages WHERE client_message_id = $1`, [clientMessageId]);
    expect(check.rows).toHaveLength(0);
    // "own" вложение осталось prepared (не привязано ни к какому сообщению) —
    // не потеряно, доступно для повторной отправки.
    const ownRow = await query(`SELECT message_id FROM chat_attachments WHERE id = $1`, [own.json().id]);
    expect(ownRow.rows[0].message_id).toBeNull();
  });

  it('дубликат id одного и того же валидного вложения в attachmentIds — отклонён (fail-closed), не задваивается', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Attach Dup Id Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const up = await upload(app, emp.telegramId, 'dup-id.txt', 'text/plain', REAL_TXT);
    attachmentIds.push(up.json().id);
    const clientMessageId = crypto.randomUUID();

    const res = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAs(emp.telegramId), 'content-type': 'application/json' },
      payload: { clientMessageId, body: null, attachmentIds: [up.json().id, up.json().id] }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_attachment');
    const check = await query(`SELECT 1 FROM chat_messages WHERE client_message_id = $1`, [clientMessageId]);
    expect(check.rows).toHaveLength(0);
  });

  it('body-less сообщение только с невалидным (просроченным) вложением — отклонено, не "empty_message"', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Attach OnlyInvalid Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const up = await upload(app, emp.telegramId, 'only-invalid.txt', 'text/plain', REAL_TXT);
    attachmentIds.push(up.json().id);
    await query(`UPDATE chat_attachments SET expires_at = now() - interval '1 minute' WHERE id = $1`, [up.json().id]);
    const clientMessageId = crypto.randomUUID();

    const res = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAs(emp.telegramId), 'content-type': 'application/json' },
      payload: { clientMessageId, body: null, attachmentIds: [up.json().id] }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_attachment');
    const check = await query(`SELECT 1 FROM chat_messages WHERE client_message_id = $1`, [clientMessageId]);
    expect(check.rows).toHaveLength(0);
  });

  it('prepared upload: TTL ровно 1 час (expiresAt ~ now + 1h, допуск ±60с)', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Attach TTL Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const before = Date.now();
    const up = await upload(app, emp.telegramId, 'ttl.txt', 'text/plain', REAL_TXT);
    attachmentIds.push(up.json().id);
    const expiresAtMs = new Date(up.json().expiresAt).getTime();
    const deltaMs = expiresAtMs - before;
    expect(deltaMs).toBeGreaterThan(59 * 60 * 1000);
    expect(deltaMs).toBeLessThan(61 * 60 * 1000);
  });

  it('orphan cleanup: просроченное непривязанное вложение удаляется — и метаданные, и bytea-блоб физически', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Attach Orphan Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const up = await upload(app, emp.telegramId, 'orphan.txt', 'text/plain', REAL_TXT);
    const id = up.json().id;
    const storageKeyRes = await query(`SELECT storage_key FROM chat_attachments WHERE id = $1`, [id]);
    const storageKey = storageKeyRes.rows[0].storage_key;

    // Блоб реально лежит ДО cleanup — иначе следующая проверка "исчез" ничего не доказывает.
    const blobBefore = await query(`SELECT 1 FROM chat_attachment_blobs WHERE storage_key = $1`, [storageKey]);
    expect(blobBefore.rows).toHaveLength(1);

    await query(`UPDATE chat_attachments SET expires_at = now() - interval '1 hour' WHERE id = $1`, [id]);
    await sweepExpiredChatAttachments();

    const rowAfter = await query(`SELECT id FROM chat_attachments WHERE id = $1`, [id]);
    expect(rowAfter.rows).toHaveLength(0);
    const blobAfter = await query(`SELECT 1 FROM chat_attachment_blobs WHERE storage_key = $1`, [storageKey]);
    expect(blobAfter.rows).toHaveLength(0);
  });

  it('orphan cleanup: org-safe — просроченные вложения ДВУХ разных сетей оба реально удаляются, ни один не задевает чужие данные', async () => {
    const app = await getApp();
    const orgA = await fx.createOrg('Attach Orphan Org A');
    const orgB = await fx.createOrg('Attach Orphan Org B');
    const empA = await fx.createEmployee(orgA, { role: 'employee' });
    const empB = await fx.createEmployee(orgB, { role: 'employee' });
    const upA = await upload(app, empA.telegramId, 'orphanA.txt', 'text/plain', REAL_TXT);
    const upB = await upload(app, empB.telegramId, 'orphanB.txt', 'text/plain', REAL_TXT);

    await query(`UPDATE chat_attachments SET expires_at = now() - interval '1 hour' WHERE id = ANY($1)`, [[upA.json().id, upB.json().id]]);
    await sweepExpiredChatAttachments();

    const rowsAfter = await query(`SELECT id, org_id FROM chat_attachments WHERE id = ANY($1)`, [[upA.json().id, upB.json().id]]);
    expect(rowsAfter.rows).toHaveLength(0); // оба удалены, каждый из своей сети — не осталось ни одного
  });

  it('orphan cleanup: НЕ удаляет вложение, уже привязанное к сообщению, даже если бы у него оказался просроченный expires_at', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Attach Attached Safe Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const up = await upload(app, emp.telegramId, 'attached-safe.txt', 'text/plain', REAL_TXT);
    const attId = up.json().id;
    attachmentIds.push(attId);

    const msgRes = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAs(emp.telegramId), 'content-type': 'application/json' },
      payload: { clientMessageId: crypto.randomUUID(), body: null, attachmentIds: [attId] }
    });
    messageIds.push(msgRes.json().id);
    expect(msgRes.json().attachments).toHaveLength(1); // реально привязалось, message_id теперь NOT NULL

    // Атаковано защитное поведение напрямую: даже если бы (по багу/гонке)
    // у уже привязанного вложения остался просроченный expires_at, cleanup
    // не должен его тронуть — запрос фильтрует по message_id IS NULL,
    // не только по expires_at. Здесь мы принудительно откатываем именно
    // этот инвариант, а не обычный путь (attachToMessage уже сам обнуляет
    // expires_at) — defense-in-depth проверка самого WHERE, не только
    // "штатной" последовательности вызовов.
    await query(`UPDATE chat_attachments SET expires_at = now() - interval '1 hour' WHERE id = $1`, [attId]);
    await sweepExpiredChatAttachments();

    const rowAfter = await query(`SELECT id, message_id FROM chat_attachments WHERE id = $1`, [attId]);
    expect(rowAfter.rows).toHaveLength(1);
    expect(rowAfter.rows[0].message_id).toBe(msgRes.json().id);
  });

  // Hotfix 20.57.1 PASS 2, finding #3 — раньше истёкшее вложение молча
  // отфильтровывалось, а сообщение с текстом всё равно создавалось без
  // единого вложения. Теперь весь запрос отклоняется целиком.
  it('истёкшее prepared-вложение — весь запрос отклонён, сообщение НЕ создаётся (fail-closed)', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Attach Expired Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const up = await upload(app, emp.telegramId, 'expired.txt', 'text/plain', REAL_TXT);
    await query(`UPDATE chat_attachments SET expires_at = now() - interval '1 minute' WHERE id = $1`, [up.json().id]);
    const clientMessageId = crypto.randomUUID();

    const res = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAs(emp.telegramId), 'content-type': 'application/json' },
      payload: { clientMessageId, body: 'с истёкшим вложением', attachmentIds: [up.json().id] }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_attachment');
    const check = await query(`SELECT 1 FROM chat_messages WHERE client_message_id = $1`, [clientMessageId]);
    expect(check.rows).toHaveLength(0);
    attachmentIds.push(up.json().id);
  });

  it('валидное + просроченное (expired) вложение вперемешку — весь запрос отклонён', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Attach Mixed Expired Org');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const expired = await upload(app, emp.telegramId, 'expired2.txt', 'text/plain', REAL_TXT);
    const valid = await upload(app, emp.telegramId, 'valid2.txt', 'text/plain', REAL_TXT);
    attachmentIds.push(expired.json().id, valid.json().id);
    await query(`UPDATE chat_attachments SET expires_at = now() - interval '1 minute' WHERE id = $1`, [expired.json().id]);
    const clientMessageId = crypto.randomUUID();

    const res = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...authAs(emp.telegramId), 'content-type': 'application/json' },
      payload: { clientMessageId, body: null, attachmentIds: [valid.json().id, expired.json().id] }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_attachment');
    const check = await query(`SELECT 1 FROM chat_messages WHERE client_message_id = $1`, [clientMessageId]);
    expect(check.rows).toHaveLength(0);
    const validRow = await query(`SELECT message_id FROM chat_attachments WHERE id = $1`, [valid.json().id]);
    expect(validRow.rows[0].message_id).toBeNull();
  });

  // Hotfix 20.57.1, finding #1 — requireCsrf (auth/csrf.ts) — глобальный
  // preHandler без исключения для /chat/attachments. requestUpload()
  // (frontend api-client.ts) раньше никогда не отправлял X-CSRF-Token —
  // браузерная/Electron cookie-сессия получала 403 на КАЖДОЙ загрузке
  // вложения. Эти тесты доказывают серверную половину контракта, который
  // теперь клиент фактически выполняет: правильный токен нужен, его
  // отсутствие блокирует, Telegram-путь (без t2_session) не затронут.
  describe('CSRF (cookie-сессия) на POST /chat/attachments', () => {
    async function makePhoneSessionEmployee() {
      const org = await fx.createOrg('Attach CSRF Org');
      const passwordHash = await hashPassword('attach-csrf-pass');
      const phone = '+7906' + Math.floor(1000000 + Math.random() * 8999999);
      const { id } = await fx.createPhoneEmployee(org, phone, passwordHash, { fullName: 'Attach CSRF Target' });
      const token = await sessionsRepo.createSession(id);
      return token;
    }

    it('cookie-сессия БЕЗ X-CSRF-Token — 403 csrf_mismatch, вложение не создаётся', async () => {
      const app = await getApp();
      const token = await makePhoneSessionEmployee();
      const { contentType, body } = buildMultipart('file', 'x.txt', 'text/plain', REAL_TXT);
      const res = await app.inject({
        method: 'POST',
        url: '/chat/attachments',
        headers: { cookie: `t2_session=${token}`, 'content-type': contentType },
        payload: body
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('csrf_mismatch');
    });

    it('cookie-сессия с СОВПАДАЮЩИМ X-CSRF-Token — проходит (proves frontend fix contract)', async () => {
      const app = await getApp();
      const token = await makePhoneSessionEmployee();
      const { contentType, body } = buildMultipart('file', 'x.txt', 'text/plain', REAL_TXT);
      const res = await app.inject({
        method: 'POST',
        url: '/chat/attachments',
        headers: {
          cookie: `t2_session=${token}; t2_csrf=matching-token`,
          'x-csrf-token': 'matching-token',
          'content-type': contentType
        },
        payload: body
      });
      expect(res.statusCode).toBe(200);
      attachmentIds.push(res.json().id);
    });

    it('Telegram-путь (без t2_session cookie) — CSRF не применяется, загрузка проходит без X-CSRF-Token', async () => {
      const app = await getApp();
      const org = await fx.createOrg('Attach CSRF Telegram Org');
      const emp = await fx.createEmployee(org, { role: 'employee' });
      const up = await upload(app, emp.telegramId, 'telegram-path.txt', 'text/plain', REAL_TXT);
      expect(up.statusCode).toBe(200);
      attachmentIds.push(up.json().id);
    });
  });
});
