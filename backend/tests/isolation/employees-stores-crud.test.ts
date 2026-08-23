import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

// Регрессия: PATCH/DELETE /employees/:id и PATCH/DELETE /stores/:id были
// вообще без проверки сети — manager любой сети мог переименовать/
// деактивировать сотрудника или точку вообще любой другой сети по
// угаданному (маленькому, последовательному для employees) id.
describe('Изоляция CRUD сотрудников и точек (PATCH/DELETE)', () => {
  const fx = new TestFixtures();
  let orgA: string, orgB: string;
  let storeA: string;
  let managerA: { id: number; telegramId: number };
  let managerB: { id: number; telegramId: number };
  let employeeA: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A');
    orgB = await fx.createOrg('Org B');
    storeA = await fx.createStore(orgA);
    managerA = await fx.createEmployee(orgA, { role: 'manager' });
    managerB = await fx.createEmployee(orgB, { role: 'manager' });
    employeeA = await fx.createEmployee(orgA, { role: 'employee', fullName: 'CRUD Target' });
  });

  afterAll(() => fx.cleanup());

  it('PATCH /employees/:id — чужая сеть получает 403', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/employees/${employeeA.id}`,
      headers: { ...authAs(managerB.telegramId), 'content-type': 'application/json' },
      payload: { full_name: 'Hacked Name' }
    });
    expect(res.statusCode).toBe(403);
  });

  it('DELETE /employees/:id — чужая сеть получает 403 (не может деактивировать)', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/employees/${employeeA.id}`,
      headers: authAs(managerB.telegramId)
    });
    expect(res.statusCode).toBe(403);
  });

  it('PATCH /employees/:id — своя сеть может редактировать', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/employees/${employeeA.id}`,
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { full_name: 'Legit Rename' }
    });
    expect(res.statusCode).toBe(200);
  });

  // Регрессия: увольнение (soft-delete) не чистило БУДУЩИЕ смены —
  // уволенный продолжал бы висеть в завтрашнем графике/покрытии точки,
  // будто реально выйдет на работу. Прошлые смены — реальная история,
  // трогать нельзя; будущие — не история, а обещание, которое больше не
  // актуально.
  it('DELETE /employees/:id — чистит будущие смены, прошлые оставляет как историю', async () => {
    const target = await fx.createEmployee(orgA, { role: 'employee', fullName: 'To Be Fired' });
    await query(
      `INSERT INTO schedules (employee_id, store_id, work_date, hours) VALUES ($1, $2, '2026-01-01', 8)`,
      [target.id, storeA]
    );
    await query(
      `INSERT INTO schedules (employee_id, store_id, work_date, hours) VALUES ($1, $2, '2099-01-01', 8)`,
      [target.id, storeA]
    );

    const app = await getApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/employees/${target.id}`,
      headers: authAs(managerA.telegramId)
    });
    expect(res.statusCode).toBe(200);

    const remaining = await query(
      `SELECT work_date FROM schedules WHERE employee_id = $1 ORDER BY work_date`,
      [target.id]
    );
    expect(remaining.rows.length).toBe(1);
    expect(new Date(remaining.rows[0].work_date).getFullYear()).toBe(2026);
  });

  it('PATCH /stores/:id — чужая сеть получает 403', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/stores/${storeA}`,
      headers: { ...authAs(managerB.telegramId), 'content-type': 'application/json' },
      payload: { name: 'Hacked Store' }
    });
    expect(res.statusCode).toBe(403);
  });

  it('DELETE /stores/:id — чужая сеть получает 403', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/stores/${storeA}`,
      headers: authAs(managerB.telegramId)
    });
    expect(res.statusCode).toBe(403);
  });

  it('PATCH /stores/:id — своя сеть может редактировать', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/stores/${storeA}`,
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { name: 'Legit Store Rename' }
    });
    expect(res.statusCode).toBe(200);
  });

  // Та же логика, что при увольнении сотрудника: закрытие точки не должно
  // оставлять сотрудников висеть в её будущем графике, но прошлая история
  // (кто реально работал на этой точке) должна остаться нетронутой.
  it('DELETE /stores/:id — чистит будущие смены на точке, прошлые оставляет как историю', async () => {
    const closingStore = await fx.createStore(orgA, 'Closing Store');
    await query(
      `INSERT INTO schedules (employee_id, store_id, work_date, hours) VALUES ($1, $2, '2026-01-01', 8)`,
      [employeeA.id, closingStore]
    );
    await query(
      `INSERT INTO schedules (employee_id, store_id, work_date, hours) VALUES ($1, $2, '2099-01-01', 8)`,
      [employeeA.id, closingStore]
    );

    const app = await getApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/stores/${closingStore}`,
      headers: authAs(managerA.telegramId)
    });
    expect(res.statusCode).toBe(200);

    const remaining = await query(
      `SELECT work_date FROM schedules WHERE store_id = $1 ORDER BY work_date`,
      [closingStore]
    );
    expect(remaining.rows.length).toBe(1);
    expect(new Date(remaining.rows[0].work_date).getFullYear()).toBe(2026);
  });
});
