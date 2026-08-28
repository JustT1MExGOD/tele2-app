/**
 * Не-Telegram вход, самопривязка (20.36) — уже авторизованный через
 * Telegram сотрудник добавляет телефон+пароль к СВОЕЙ карточке как второй
 * способ входа. В отличие от POST /auth/register (открытая регистрация
 * для тех, у кого ещё нет аккаунта) — здесь identity уже подтверждена,
 * approve через access_requests не требуется.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import { normalizePhone } from '../../src/utils/phone.js';

// 20.48.0 — уже в каноническом формате normalizePhone() (+7XXXXXXXXXX),
// чтобы raw-значение теста и то, что реально сохранится/резолвится через
// identities, совпадали побайтово — без этого сравнение теста с БД ловит
// не баг, а собственную нестрогость своего же генератора номеров.
function uniquePhone(): string {
  return '+7901' + Math.floor(1000000 + Math.random() * 8999999);
}

describe('POST /me/link-phone — самопривязка телефона к уже авторизованному аккаунту', () => {
  const fx = new TestFixtures();
  const extraEmployeeIds: number[] = [];

  afterAll(async () => {
    if (extraEmployeeIds.length) {
      await query(`DELETE FROM employees WHERE id = ANY($1)`, [extraEmployeeIds]);
    }
    await fx.cleanup();
  });

  it('без Telegram-идентичности — 401', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/me/link-phone',
      payload: { phone: uniquePhone(), password: 'password123' }
    });
    expect(res.statusCode).toBe(401);
  });

  it('некорректный телефон — 400', async () => {
    const app = await getApp();
    const org = await fx.createOrg('LinkPhone Invalid Org');
    const employee = await fx.createEmployee(org, { role: 'employee' });
    const res = await app.inject({
      method: 'POST',
      url: '/me/link-phone',
      headers: authAs(employee.telegramId),
      payload: { phone: 'not-a-phone', password: 'password123' }
    });
    expect(res.statusCode).toBe(400);
  });

  it('успех — GET /me отдаёт phone:null до привязки и сам номер после; логин по телефону работает после привязки', async () => {
    const app = await getApp();
    const org = await fx.createOrg('LinkPhone Success Org');
    const employee = await fx.createEmployee(org, { role: 'employee' });
    const phone = uniquePhone();

    const before = await app.inject({ method: 'GET', url: '/me', headers: authAs(employee.telegramId) });
    expect(before.json().phone).toBeNull();

    const link = await app.inject({
      method: 'POST',
      url: '/me/link-phone',
      headers: authAs(employee.telegramId),
      payload: { phone, password: 'my-new-password' }
    });
    expect(link.statusCode).toBe(200);
    expect(link.json()).toEqual({ ok: true });

    const after = await app.inject({ method: 'GET', url: '/me', headers: authAs(employee.telegramId) });
    expect(after.json().phone).toBe(phone);

    // Telegram-идентичность не тронута — тот же employee всё ещё логинится через неё.
    expect(after.json().employee_id).toBe(employee.id);

    // И теперь новый канал тоже работает — тот же сотрудник логинится по телефону.
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { phone, password: 'my-new-password' } });
    expect(login.statusCode).toBe(200);
  });

  it('телефон уже занят другим сотрудником — 409, свой номер не трогается', async () => {
    const app = await getApp();
    const org = await fx.createOrg('LinkPhone Taken Org');
    const takenPhone = normalizePhone(uniquePhone())!;
    const occupant = await query(
      `INSERT INTO employees (full_name, phone, password_hash, role, access_status, is_active, org_id)
       VALUES ('Occupant', $1, 'scrypt$aa$bb', 'employee', 'active', true, $2) RETURNING id`,
      [takenPhone, org]
    );
    extraEmployeeIds.push(occupant.rows[0].id);
    // 20.48.0 — identitiesRepo.bindIdentityStrict резолвит конфликт через
    // identities, не employees.phone напрямую — фикстура должна держать оба
    // в синхроне, как и production-путь (approveExistingPhone и т.п.).
    await query(
      `INSERT INTO identities (employee_id, provider, provider_key) VALUES ($1, 'phone', $2)`,
      [occupant.rows[0].id, takenPhone]
    );
    const employee = await fx.createEmployee(org, { role: 'employee' });

    const res = await app.inject({
      method: 'POST',
      url: '/me/link-phone',
      headers: authAs(employee.telegramId),
      payload: { phone: takenPhone, password: 'password123' }
    });
    expect(res.statusCode).toBe(409);

    const row = await query(`SELECT phone FROM employees WHERE id = $1`, [employee.id]);
    expect(row.rows[0].phone).toBeNull();
  });
});
