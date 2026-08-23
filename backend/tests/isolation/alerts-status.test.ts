import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import { insertAlertOnce } from '../../src/core/alerts/service.js';

// 18.6 Alerts 2.0 — полный жизненный цикл алерта (не только open->acked),
// атомарная защита от дублей, авто-resolve через связанную задачу (18.4).
describe('Alerts 2.0', () => {
  const fx = new TestFixtures();
  let orgA: string, orgB: string;
  let storeA: string, storeB: string;
  let managerA: { id: number; telegramId: number };
  let managerB: { id: number; telegramId: number };
  let employeeA: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A');
    orgB = await fx.createOrg('Org B');
    storeA = await fx.createStore(orgA);
    storeB = await fx.createStore(orgB);
    managerA = await fx.createEmployee(orgA, { role: 'manager' });
    managerB = await fx.createEmployee(orgB, { role: 'manager' });
    employeeA = await fx.createEmployee(orgA, { role: 'employee' });
  });

  afterAll(async () => {
    await query(
      `DELETE FROM task_comments WHERE task_id IN (SELECT id FROM tasks WHERE created_by = $1)`,
      [managerA.id]
    );
    await query(`DELETE FROM tasks WHERE created_by = $1`, [managerA.id]);
    await query(`DELETE FROM smart_alerts WHERE store_id = ANY($1)`, [[storeA, storeB]]);
    await fx.cleanup();
  });

  // Регрессия: insertAlertOnce() была SELECT-проверкой и отдельным INSERT —
  // тот же класс гонки, что уже дважды чинили сегодня. Два одновременных
  // вызова (как два перекрывшихся при деплое контейнера) должны дать
  // ровно один реальный алерт, не два.
  it('insertAlertOnce — два параллельных вызова с тем же типом/точкой/днём дают ровно один алерт', async () => {
    const opts = {
      store_id: storeA,
      alert_type: 'test17_dedup_race',
      severity: 'warn',
      title: 'Test race alert',
      body: 'test',
      payload: {}
    };
    const [r1, r2] = await Promise.all([insertAlertOnce(opts), insertAlertOnce(opts)]);
    const wonCount = [r1, r2].filter(Boolean).length;
    expect(wonCount).toBe(1);

    const rows = await query(
      `SELECT id FROM smart_alerts WHERE store_id = $1 AND alert_type = $2 AND status = 'open'`,
      [storeA, 'test17_dedup_race']
    );
    expect(rows.rows.length).toBe(1);
  });

  let alertId: number;

  it('GET /alerts — manager другой сети не видит чужой алерт', async () => {
    const ins = await query(
      `INSERT INTO smart_alerts (store_id, alert_type, severity, title, status)
       VALUES ($1,'cash_gap','critical','Кассовый разрыв','open') RETURNING id`,
      [storeA]
    );
    alertId = Number(ins.rows[0].id);

    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/alerts',
      headers: authAs(managerB.telegramId)
    });
    const body = res.json();
    expect(body.find((a: any) => Number(a.id) === alertId)).toBeUndefined();
  });

  it('GET /alerts — manager своей сети видит алерт', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/alerts',
      headers: authAs(managerA.telegramId)
    });
    const body = res.json();
    expect(body.find((a: any) => Number(a.id) === alertId)).toBeDefined();
  });

  it('POST /alerts/:id/status — manager чужой сети получает 403', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: `/alerts/${alertId}/status`,
      headers: { ...authAs(managerB.telegramId), 'content-type': 'application/json' },
      payload: { status: 'in_progress' }
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST /alerts/:id/status — нельзя вернуть в open через этот эндпоинт', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: `/alerts/${alertId}/status`,
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { status: 'open' }
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /alerts/:id/status — manager своей сети переводит алерт in_progress -> dismissed', async () => {
    const app = await getApp();
    const inProgress = await app.inject({
      method: 'POST',
      url: `/alerts/${alertId}/status`,
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { status: 'in_progress' }
    });
    expect(inProgress.statusCode).toBe(200);
    expect(inProgress.json().status).toBe('in_progress');

    const dismissed = await app.inject({
      method: 'POST',
      url: `/alerts/${alertId}/status`,
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { status: 'dismissed' }
    });
    expect(dismissed.statusCode).toBe(200);
    expect(dismissed.json().status).toBe('dismissed');
  });

  it('GET /alerts?status=dismissed — фильтр по статусу работает', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/alerts?status=dismissed',
      headers: authAs(managerA.telegramId)
    });
    const body = res.json();
    expect(body.find((a: any) => Number(a.id) === alertId)).toBeDefined();
  });

  it('задача, созданная из алерта, автоматически resolve-ит его при выполнении', async () => {
    const ins = await query(
      `INSERT INTO smart_alerts (store_id, alert_type, severity, title, status)
       VALUES ($1,'cash_gap','warn','Ещё один разрыв','open') RETURNING id`,
      [storeA]
    );
    const linkedAlertId = Number(ins.rows[0].id);

    const app = await getApp();
    const createTask = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: {
        title: 'Проверить кассу',
        assigned_to: employeeA.id,
        store_id: storeA,
        alert_id: linkedAlertId
      }
    });
    expect(createTask.statusCode).toBe(200);
    const taskId = Number(createTask.json().id);

    const done = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/status`,
      headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
      payload: { status: 'done' }
    });
    expect(done.statusCode).toBe(200);

    const alertRow = await query(`SELECT status FROM smart_alerts WHERE id = $1`, [linkedAlertId]);
    expect(alertRow.rows[0].status).toBe('resolved');
  });
});
