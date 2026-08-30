import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';

// Регрессия на фикс 15.11.0: GET/POST /employees раньше не были scoped по
// сети — «Команда» показывала сотрудников всех сетей вперемешку.
describe('Изоляция сотрудников (/employees)', () => {
  const fx = new TestFixtures();
  let orgA: string, orgB: string;
  let managerA: { id: number; telegramId: number };
  let managerB: { id: number; telegramId: number };
  let admin: { id: number; telegramId: number };
  let employeeA: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A');
    orgB = await fx.createOrg('Org B');
    managerA = await fx.createEmployee(orgA, { role: 'manager' });
    managerB = await fx.createEmployee(orgB, { role: 'manager' });
    admin = await fx.createEmployee(orgA, { role: 'admin' });
    employeeA = await fx.createEmployee(orgA, { role: 'employee', fullName: 'Employee From Org A' });
  });

  afterAll(() => fx.cleanup());

  it('GET /employees — manager видит только сотрудников своей сети', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/employees', headers: authAs(managerB.telegramId) });
    const rows = res.json();
    expect(rows.find((r: any) => Number(r.id) === employeeA.id)).toBeUndefined();
  });

  it('GET /employees — своя сеть видна целиком', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/employees', headers: authAs(managerA.telegramId) });
    const rows = res.json();
    expect(rows.find((r: any) => Number(r.id) === employeeA.id)).toBeDefined();
  });

  it('POST /employees — новый сотрудник попадает в сеть создающего manager', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/employees',
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { full_name: 'New Hire A' }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    fx.employeeIds.push(body.id);
    expect(body.org_id).toBe(orgA);
  });

  it('POST /employees — не-admin override org_id игнорируется', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/employees',
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { full_name: 'New Hire Attempted Cross Org', org_id: orgB }
    });
    const body = res.json();
    fx.employeeIds.push(body.id);
    expect(body.org_id).toBe(orgA);
  });

  it('POST /employees — admin с override org_id заводит сотрудника в выбранной сети', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/employees',
      headers: { ...authAs(admin.telegramId, admin.telegramGrantToken), 'content-type': 'application/json' },
      payload: { full_name: 'New Hire B via Admin', org_id: orgB }
    });
    const body = res.json();
    fx.employeeIds.push(body.id);
    expect(body.org_id).toBe(orgB);
  });

  // 20.50.0 (Web Security & Trust Layer, часть 3) — двойной тап/ретрай
  // раньше молча создавал двух сотрудников с одинаковым full_name/role/
  // org_id (нет UNIQUE на (full_name, org_id), id — обычный serial).
  // Тот же приём, что уже у POST /tasks (claimIdempotencyKey).
  it('POST /employees с client_id — повторный запрос дедуплицируется, создан ровно один сотрудник', async () => {
    const app = await getApp();
    const clientId = `test-dup-${Date.now()}`;
    const payload = { full_name: 'Idempotent Hire', client_id: clientId };

    const first = await app.inject({
      method: 'POST',
      url: '/employees',
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    fx.employeeIds.push(firstBody.id);

    const second = await app.inject({
      method: 'POST',
      url: '/employees',
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ ok: true, deduped: true });

    const list = await app.inject({ method: 'GET', url: '/employees', headers: authAs(managerA.telegramId) });
    const matches = list.json().filter((r: any) => r.full_name === 'Idempotent Hire');
    expect(matches.length).toBe(1);
  });

  it('POST /employees без client_id (легаси-клиент) — повторный запрос по-прежнему создаёт двух сотрудников (обратная совместимость)', async () => {
    const app = await getApp();
    const payload = { full_name: 'Legacy Double Submit' };

    const first = await app.inject({
      method: 'POST',
      url: '/employees',
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload
    });
    fx.employeeIds.push(first.json().id);

    const second = await app.inject({
      method: 'POST',
      url: '/employees',
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload
    });
    fx.employeeIds.push(second.json().id);

    expect(Number(first.json().id)).not.toBe(Number(second.json().id));
  });
});
