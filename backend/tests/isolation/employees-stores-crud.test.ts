import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';

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
});
