/**
 * 20.51.0 (Application-Level Envelope Encryption, Phase B) — end-to-end
 * через реальные роуты /support/* + реальный Postgres: проверяет, что
 * включённое шифрование (a) реально меняет то, что лежит в raw-колонке
 * (§34 Security — "DB dump lacks plaintext"), (b) остаётся прозрачным для
 * вызывающего кода (роуты/фронтенд не видят разницы), (c) переживает
 * key rotation, (d) не ломает старое поведение при выключенном флаге.
 *
 * process.env для DATA_ENCRYPTION_ENABLED/ENCRYPTION_KEKS/
 * ENCRYPTION_ACTIVE_KEY_VERSION читается заново на каждый вызов
 * (key-provider.ts), поэтому можно переключать их прямо в тесте — файлы
 * гоняются последовательно в одном процессе (fileParallelism:false), но
 * это единственный файл, трогающий эти переменные, и каждый it()
 * восстанавливает их в afterEach, чтобы не протечь в соседние файлы.
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { query } from '../../src/data/db/index.js';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { isEncryptedEnvelope } from '../../src/security/crypto/envelope.js';

const ORIGINAL_ENV: Record<string, string | undefined> = {
  DATA_ENCRYPTION_ENABLED: process.env.DATA_ENCRYPTION_ENABLED,
  ENCRYPTION_KEKS: process.env.ENCRYPTION_KEKS,
  ENCRYPTION_ACTIVE_KEY_VERSION: process.env.ENCRYPTION_ACTIVE_KEY_VERSION
};

function restoreEnv() {
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function enableEncryption(versions: Record<string, string>, active: string) {
  process.env.DATA_ENCRYPTION_ENABLED = 'true';
  process.env.ENCRYPTION_KEKS = JSON.stringify(versions);
  process.env.ENCRYPTION_ACTIVE_KEY_VERSION = active;
}

const KEY_V1 = Buffer.alloc(32, 0x21).toString('base64');
const KEY_V2 = Buffer.alloc(32, 0x22).toString('base64');

describe('Application-Level Envelope Encryption — support tickets (реальные роуты + Postgres)', () => {
  const fx = new TestFixtures();
  const createdTicketIds: number[] = [];

  afterEach(restoreEnv);
  afterAll(async () => {
    if (createdTicketIds.length) {
      await query(`DELETE FROM support_messages WHERE ticket_id = ANY($1)`, [createdTicketIds]);
      await query(`DELETE FROM support_tickets WHERE id = ANY($1)`, [createdTicketIds]);
    }
    await fx.cleanup();
  });

  it('шифрование ВЫКЛЮЧЕНО (по умолчанию) — message хранится и читается plaintext, как раньше', async () => {
    restoreEnv();
    delete process.env.DATA_ENCRYPTION_ENABLED;
    const app = await getApp();
    const org = await fx.createOrg('Support Plain Org');
    const emp = await fx.createEmployee(org, { role: 'employee', fullName: 'Обычный сотрудник' });

    const res = await app.inject({
      method: 'POST',
      url: '/support',
      headers: authAs(emp.telegramId),
      payload: { message: 'Не работает касса на точке' }
    });
    expect(res.statusCode).toBe(200);
    const ticketId = res.json().ticket.id as number;
    createdTicketIds.push(ticketId);

    const row = (await query(`SELECT message, message_encrypted FROM support_tickets WHERE id = $1`, [ticketId])).rows[0];
    expect(row.message).toBe('Не работает касса на точке');
    expect(row.message_encrypted).toBeNull();
  });

  it('шифрование ВКЛЮЧЕНО — raw-колонка message НЕ содержит plaintext, message_encrypted валидный конверт, чтение возвращает исходный текст', async () => {
    enableEncryption({ v1: KEY_V1 }, 'v1');
    const app = await getApp();
    const org = await fx.createOrg('Support Encrypted Org');
    const emp = await fx.createEmployee(org, { role: 'employee', fullName: 'Секретный Сотрудников' });
    const secretText = 'У меня личная проблема, прошу не разглашать: задержка зарплаты';

    const res = await app.inject({
      method: 'POST',
      url: '/support',
      headers: authAs(emp.telegramId),
      payload: { message: secretText }
    });
    expect(res.statusCode).toBe(200);
    const ticketId = res.json().ticket.id as number;
    createdTicketIds.push(ticketId);

    // §34 Security — «DB dump lacks plaintext»: сырой SELECT той же
    // колонки, которую увидел бы кто угодно с доступом к дампу БД, не
    // содержит секретного текста ни в каком виде.
    const row = (await query(`SELECT message, message_encrypted FROM support_tickets WHERE id = $1`, [ticketId])).rows[0];
    expect(row.message).not.toContain('задержка зарплаты');
    expect(row.message).toBe('[зашифровано]');
    expect(isEncryptedEnvelope(row.message_encrypted)).toBe(true);
    expect(JSON.stringify(row.message_encrypted)).not.toContain('задержка');

    // Но приложение (через тот же GET, что видит владелец/admin) получает
    // исходный текст обратно прозрачно.
    const getRes = await app.inject({
      method: 'GET',
      url: `/support/tickets/${ticketId}/messages`,
      headers: authAs(emp.telegramId)
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().ticket.message).toBe(secretText);
  });

  it('admin_reply и support_messages.body тоже шифруются и прозрачно расшифровываются на чтение', async () => {
    enableEncryption({ v1: KEY_V1 }, 'v1');
    const app = await getApp();
    const org = await fx.createOrg('Support Reply Org');
    const admin = await fx.createEmployee(org, { role: 'admin', fullName: 'Админ' });
    const emp = await fx.createEmployee(org, { role: 'employee', fullName: 'Сотрудник с вопросом' });

    const createRes = await app.inject({
      method: 'POST',
      url: '/support',
      headers: authAs(emp.telegramId),
      payload: { message: 'Вопрос по графику' }
    });
    const ticketId = createRes.json().ticket.id as number;
    createdTicketIds.push(ticketId);

    const replyRes = await app.inject({
      method: 'POST',
      url: `/support/tickets/${ticketId}/reply`,
      headers: authAs(admin.telegramId, admin.telegramGrantToken),
      payload: { reply: 'Ответ администратора — конфиденциальный контекст сотрудника' }
    });
    expect(replyRes.statusCode).toBe(200);
    expect(replyRes.json().admin_reply).toBe('Ответ администратора — конфиденциальный контекст сотрудника');

    const ticketRow = (await query(`SELECT admin_reply, admin_reply_encrypted FROM support_tickets WHERE id = $1`, [ticketId])).rows[0];
    expect(ticketRow.admin_reply).toBe('[зашифровано]');
    expect(isEncryptedEnvelope(ticketRow.admin_reply_encrypted)).toBe(true);

    const msgRes = await app.inject({
      method: 'POST',
      url: `/support/tickets/${ticketId}/messages`,
      headers: authAs(emp.telegramId),
      payload: { message: 'Уточняющий вопрос от сотрудника' }
    });
    expect(msgRes.statusCode).toBe(200);
    expect(msgRes.json().body).toBe('Уточняющий вопрос от сотрудника');

    const msgRow = (
      await query(`SELECT body, body_encrypted FROM support_messages WHERE ticket_id = $1 ORDER BY created_at DESC LIMIT 1`, [ticketId])
    ).rows[0];
    expect(msgRow.body).toBe('[зашифровано]');
    expect(isEncryptedEnvelope(msgRow.body_encrypted)).toBe(true);

    // Полный тред через владельца всё равно читается открытым текстом.
    const threadRes = await app.inject({
      method: 'GET',
      url: `/support/tickets/${ticketId}/messages`,
      headers: authAs(emp.telegramId)
    });
    const bodies = (threadRes.json().messages as any[]).map((m) => m.body);
    expect(bodies).toContain('Вопрос по графику');
    expect(bodies).toContain('Уточняющий вопрос от сотрудника');
  });

  it('key rotation: тикет, зашифрованный под v1, остаётся читаемым после того как активной стала v2', async () => {
    enableEncryption({ v1: KEY_V1 }, 'v1');
    const app = await getApp();
    const org = await fx.createOrg('Support Rotation Org');
    const emp = await fx.createEmployee(org, { role: 'employee', fullName: 'До ротации' });

    const res = await app.inject({
      method: 'POST',
      url: '/support',
      headers: authAs(emp.telegramId),
      payload: { message: 'Текст до ротации ключа' }
    });
    const ticketId = res.json().ticket.id as number;
    createdTicketIds.push(ticketId);

    const rowBefore = (await query(`SELECT message_encrypted FROM support_tickets WHERE id = $1`, [ticketId])).rows[0];
    expect(rowBefore.message_encrypted.kid).toBe('v1');

    // Ротация: v2 становится активной, v1 остаётся известной (для чтения
    // старых конвертов) — без этого поле в ENCRYPTION_KEKS старый тикет
    // стал бы нечитаемым, что и было бы недопустимой потерей данных.
    enableEncryption({ v1: KEY_V1, v2: KEY_V2 }, 'v2');

    const getRes = await app.inject({
      method: 'GET',
      url: `/support/tickets/${ticketId}/messages`,
      headers: authAs(emp.telegramId)
    });
    expect(getRes.json().ticket.message).toBe('Текст до ротации ключа');

    // Новый тикет после ротации шифруется уже под v2.
    const res2 = await app.inject({
      method: 'POST',
      url: '/support',
      headers: authAs(emp.telegramId),
      payload: { message: 'Текст после ротации' }
    });
    const ticketId2 = res2.json().ticket.id as number;
    createdTicketIds.push(ticketId2);
    const rowAfter = (await query(`SELECT message_encrypted FROM support_tickets WHERE id = $1`, [ticketId2])).rows[0];
    expect(rowAfter.message_encrypted.kid).toBe('v2');
  });

  it('повреждённый конверт — чтение отдаёт явный маркер ошибки, не 500 и не тихий plaintext-фолбэк', async () => {
    enableEncryption({ v1: KEY_V1 }, 'v1');
    const app = await getApp();
    const org = await fx.createOrg('Support Corrupt Org');
    const emp = await fx.createEmployee(org, { role: 'employee', fullName: 'Испорченный конверт' });

    const res = await app.inject({
      method: 'POST',
      url: '/support',
      headers: authAs(emp.telegramId),
      payload: { message: 'Будет испорчено' }
    });
    const ticketId = res.json().ticket.id as number;
    createdTicketIds.push(ticketId);

    // Ломаем ciphertext прямо в БД — симулирует битую строку/чужой ключ.
    const row = (await query(`SELECT message_encrypted FROM support_tickets WHERE id = $1`, [ticketId])).rows[0];
    const corrupted = { ...row.message_encrypted, data: { ...row.message_encrypted.data, ciphertext: Buffer.from('garbage-ciphertext-bytes').toString('base64') } };
    await query(`UPDATE support_tickets SET message_encrypted = $1 WHERE id = $2`, [JSON.stringify(corrupted), ticketId]);

    const getRes = await app.inject({
      method: 'GET',
      url: `/support/tickets/${ticketId}/messages`,
      headers: authAs(emp.telegramId)
    });
    expect(getRes.statusCode).toBe(200); // сам запрос не падает 500
    expect(getRes.json().ticket.message).toBe('[ошибка расшифровки]');
  });

  it('cross-employee/IDOR — чужой сотрудник по-прежнему не видит тред тикета, шифрование не подменяет авторизацию', async () => {
    enableEncryption({ v1: KEY_V1 }, 'v1');
    const app = await getApp();
    const org = await fx.createOrg('Support IDOR Org');
    const owner = await fx.createEmployee(org, { role: 'employee', fullName: 'Владелец тикета' });
    const stranger = await fx.createEmployee(org, { role: 'employee', fullName: 'Посторонний' });

    const res = await app.inject({
      method: 'POST',
      url: '/support',
      headers: authAs(owner.telegramId),
      payload: { message: 'Приватный вопрос владельца' }
    });
    const ticketId = res.json().ticket.id as number;
    createdTicketIds.push(ticketId);

    const strangerRes = await app.inject({
      method: 'GET',
      url: `/support/tickets/${ticketId}/messages`,
      headers: authAs(stranger.telegramId)
    });
    expect(strangerRes.statusCode).toBe(403);
  });
});
