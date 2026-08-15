import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';

describe('batch 3, п.7 — display_name перекрывает name везде в мини-аппе', () => {
  const fx = new TestFixtures();
  let orgId: string;
  let storeId: string;
  let manager: { id: number; telegramId: number };
  let employee: { id: number; telegramId: number };

  beforeAll(async () => {
    orgId = await fx.createOrg('Org DN');
    storeId = await fx.createStore(orgId, 'Калинина 2');
    manager = await fx.createEmployee(orgId, { role: 'manager' });
    employee = await fx.createEmployee(orgId, { role: 'employee' });
  });

  afterAll(() => fx.cleanup());

  it('PATCH /stores/:id принимает display_name (manager/senior/admin)', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/stores/${encodeURIComponent(storeId)}`,
      headers: authAs(manager.telegramId),
      payload: { display_name: 'Заря' }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().display_name).toBe('Заря');
  });

  it('GET /org/stores отдаёт display_name вместо сырого name', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/org/stores', headers: authAs(manager.telegramId) });
    const store = res.json().stores.find((s: any) => s.id === storeId);
    expect(store.name).toBe('Заря');
  });

  it('обычный сотрудник не может менять display_name', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/stores/${encodeURIComponent(storeId)}`,
      headers: authAs(employee.telegramId),
      payload: { display_name: 'Хакнуто' }
    });
    expect(res.statusCode).toBe(403);
  });

  it('сброс display_name на null возвращает исходное name', async () => {
    const app = await getApp();
    const clear = await app.inject({
      method: 'PATCH',
      url: `/stores/${encodeURIComponent(storeId)}`,
      headers: authAs(manager.telegramId),
      payload: { display_name: null }
    });
    expect(clear.statusCode).toBe(200);
    const res = await app.inject({ method: 'GET', url: '/org/stores', headers: authAs(manager.telegramId) });
    const store = res.json().stores.find((s: any) => s.id === storeId);
    expect(store.name).toBe('Калинина 2');
  });
});
