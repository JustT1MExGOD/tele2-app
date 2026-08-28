import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { fireConcurrent, countStatus } from '../helpers/concurrency.js';
import { query } from '../../src/data/db/index.js';

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

  // Регрессия: GET /employees (единственный источник списка карточек для
  // бинда во фронте) уже фильтрует is_active=true, но сам POST /me/bind
  // принимал employee_id из тела без проверки и сам же реактивировал
  // карточку (is_active=true) на любой bind. employee_id — маленький
  // последовательный int, легко угадать/запомнить — без этой проверки
  // кто угодно руками (в обход фронта) мог привязать свой Telegram к
  // карточке уволенного и унаследовать всю его историю продаж/BFQ/XP.
  it('нельзя привязаться к деактивированной (уволенной) карточке', async () => {
    const fired = await fx.createEmployee(orgA, { role: 'employee', fullName: 'Fired Employee' });
    await query(`UPDATE employees SET is_active = false, telegram_id = NULL WHERE id = $1`, [fired.id]);

    const newHireTelegramId = Math.floor(9_000_000_000 + Math.random() * 900_000_000);
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/me/bind',
      headers: { 'x-telegram-id': String(newHireTelegramId), 'content-type': 'application/json' },
      payload: { employee_id: fired.id }
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('employee_inactive');

    const row = await query(`SELECT is_active, telegram_id FROM employees WHERE id = $1`, [fired.id]);
    expect(row.rows[0].is_active).toBe(false);
    expect(row.rows[0].telegram_id).toBeNull();
  });

  // 20.16.0 (adversarial race-condition suite): код в api/routes/me/index.ts
  // сам документирует "узкое окно гонки" между SELECT-чеком карточки и
  // UPDATE-привязкой — claim в комментарии, что employees.telegram_id UNIQUE
  // (0002) спасает проигравший запрос, ловится и превращается в чистый 409,
  // а не портит данные. Раньше это утверждение не было проверено реальным
  // конкурентным запросом — только последовательными сценариями выше.
  it('race: 5 параллельных bind одним telegram_id на 5 разных незанятых карточек — побеждает ровно одна', async () => {
    const app = await getApp();
    const raceTelegramId = Math.floor(9_000_000_000 + Math.random() * 900_000_000);
    const candidates = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        fx.createEmployee(orgA, { role: 'employee', fullName: `Race Candidate ${i}`, telegramId: null })
      )
    );

    const results = await fireConcurrent(app, (i) => ({
      method: 'POST',
      url: '/me/bind',
      headers: { 'x-telegram-id': String(raceTelegramId), 'content-type': 'application/json' },
      payload: { employee_id: candidates[i].id }
    }), 5);

    expect(countStatus(results, [200])).toBe(1);
    expect(countStatus(results, [409])).toBe(4);

    const owners = await query(
      `SELECT id FROM employees WHERE telegram_id = $1`,
      [raceTelegramId]
    );
    expect(owners.rows.length).toBe(1);

    // 20.48.0 (Web Security & Trust Layer) — employees.telegram_id и
    // identities(provider='telegram') не могут разойтись: ровно одна
    // строка identities, указывающая на ТОГО ЖЕ сотрудника, что победил
    // в employees.
    const identityRows = await query(
      `SELECT employee_id FROM identities WHERE provider='telegram' AND provider_key=$1`,
      [String(raceTelegramId)]
    );
    expect(identityRows.rows.length).toBe(1);
    expect(Number(identityRows.rows[0].employee_id)).toBe(Number(owners.rows[0].id));
  });

  // 20.48.0 — transfer-сценарий: сотрудник A уже привязан к Telegram X,
  // тот же физический Telegram X self-bind'ит на НЕзанятую карточку B —
  // claimTelegramId() обязан снять X с A и поставить на B атомарно, в
  // обеих таблицах (employees.telegram_id и identities) одновременно.
  it('transfer: self-bind тем же telegram_id на другую карточку снимает его с прежней и переносит в identities', async () => {
    const app = await getApp();
    const transferTelegramId = Math.floor(9_000_000_000 + Math.random() * 900_000_000);
    const cardA = await fx.createEmployee(orgA, { role: 'employee', fullName: 'Card A', telegramId: transferTelegramId });
    const cardB = await fx.createEmployee(orgA, { role: 'employee', fullName: 'Card B', telegramId: null });

    const res = await app.inject({
      method: 'POST',
      url: '/me/bind',
      headers: { 'x-telegram-id': String(transferTelegramId), 'content-type': 'application/json' },
      payload: { employee_id: cardB.id }
    });
    expect(res.statusCode).toBe(200);

    const rows = await query(`SELECT id, telegram_id FROM employees WHERE id = ANY($1)`, [[cardA.id, cardB.id]]);
    const a = rows.rows.find((r: any) => Number(r.id) === cardA.id);
    const b = rows.rows.find((r: any) => Number(r.id) === cardB.id);
    expect(a.telegram_id).toBeNull();
    expect(Number(b.telegram_id)).toBe(transferTelegramId);

    const identityRows = await query(
      `SELECT employee_id FROM identities WHERE provider='telegram' AND provider_key=$1`,
      [String(transferTelegramId)]
    );
    expect(identityRows.rows.length).toBe(1);
    expect(Number(identityRows.rows[0].employee_id)).toBe(cardB.id);
  });
});
