import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';

// Регрессия: /sales/quick и /sync/batch (офлайн-очередь) — параллельные пути
// внесения продажи в обход основного POST /sales — не проверяли ни "свой ли
// это сотрудник", ни "своя ли сеть" (assertStoreInOrg), employee_id/store_id
// брались из тела запроса как есть.
describe('Изоляция быстрого ввода и офлайн-синхронизации (/sales/quick, /sync/batch)', () => {
  const fx = new TestFixtures();
  let orgA: string, orgB: string;
  let storeA: string, storeB: string;
  let managerA: { id: number; telegramId: number };
  let seniorA: { id: number; telegramId: number };
  let employeeA: { id: number; telegramId: number };
  let employeeB: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A');
    orgB = await fx.createOrg('Org B');
    storeA = await fx.createStore(orgA);
    storeB = await fx.createStore(orgB);
    managerA = await fx.createEmployee(orgA, { role: 'manager' });
    seniorA = await fx.createEmployee(orgA, { role: 'senior' });
    employeeA = await fx.createEmployee(orgA, { role: 'employee' });
    employeeB = await fx.createEmployee(orgB, { role: 'employee' });
  });

  afterAll(() => fx.cleanup());

  it('POST /sales/quick — employee не может внести продажу за другого сотрудника', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sales/quick',
      headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
      payload: { text: '2 симки', employee_id: employeeB.id, store_id: storeA }
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST /sales/quick — manager не может внести продажу за сотрудника на точке чужой сети', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sales/quick',
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { text: '2 симки', employee_id: employeeA.id, store_id: storeB }
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST /sales/quick — manager может внести продажу за сотрудника своей сети', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sales/quick',
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { text: '2 симки', employee_id: employeeA.id, store_id: storeA }
    });
    expect(res.statusCode).toBe(200);
  });

  it('POST /sync/batch — сотрудник не может синхронизировать чужую продажу на чужой сети', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sync/batch',
      headers: { ...authAs(employeeB.telegramId), 'content-type': 'application/json' },
      payload: {
        ops: [
          {
            client_id: 'test17-sync-' + Date.now(),
            type: 'sale',
            employee_id: employeeA.id,
            store_id: storeA,
            sale_date: '2026-06-19',
            metrics: { sim: 1 }
          }
        ]
      }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results[0].status).toBe('rejected');
  });

  // H3 (аудит безопасности v20.11.1): senior раньше мог вносить/синхронизировать
  // продажи ЗА ДРУГОГО через эти два пути (через общий isManager()), хотя основной
  // POST /sales уже отдельно запрещал это senior — один и тот же вопрос имел два
  // разных ответа в зависимости от точки входа. Теперь единая проверка
  // (canWriteSalesForOthers) — senior везде наравне с employee.
  it('POST /sales/quick — senior не может внести продажу за другого сотрудника', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sales/quick',
      headers: { ...authAs(seniorA.telegramId), 'content-type': 'application/json' },
      payload: { text: '2 симки', employee_id: employeeA.id, store_id: storeA }
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST /sync/batch — senior не может синхронизировать продажу за другого сотрудника', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sync/batch',
      headers: { ...authAs(seniorA.telegramId), 'content-type': 'application/json' },
      payload: {
        ops: [
          {
            client_id: 'test17-sync-senior-' + Date.now(),
            type: 'sale',
            employee_id: employeeA.id,
            store_id: storeA,
            sale_date: '2026-06-19',
            metrics: { sim: 1 }
          }
        ]
      }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results[0].status).toBe('rejected');
  });

  it('POST /sync/batch — свою продажу синхронизировать можно', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sync/batch',
      headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
      payload: {
        ops: [
          {
            client_id: 'test17-sync-ok-' + Date.now(),
            type: 'sale',
            store_id: storeA,
            sale_date: '2026-06-19',
            metrics: { sim: 1 }
          }
        ]
      }
    });
    const body = res.json();
    expect(body.results[0].status).toBe('applied');
  });
});
