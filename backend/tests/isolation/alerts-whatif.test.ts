import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/db/index.js';

describe('Изоляция алертов (POST /alerts/:id/ack) и what-if (/schedule/what-if*)', () => {
  const fx = new TestFixtures();
  const WORK_DATE = '2026-06-17';
  let orgA: string, orgB: string;
  let storeA: string, storeB: string;
  let managerA: { id: number; telegramId: number };
  let managerB: { id: number; telegramId: number };
  let employeeA: { id: number; telegramId: number };
  let alertId: number;

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A');
    orgB = await fx.createOrg('Org B');
    storeA = await fx.createStore(orgA);
    storeB = await fx.createStore(orgB);
    managerA = await fx.createEmployee(orgA, { role: 'manager' });
    managerB = await fx.createEmployee(orgB, { role: 'manager' });
    employeeA = await fx.createEmployee(orgA, { role: 'employee' });

    const res = await query(
      `INSERT INTO smart_alerts (store_id, alert_type, title, status) VALUES ($1, 'lag', 'Test alert', 'open') RETURNING id`,
      [storeA]
    );
    alertId = Number(res.rows[0].id);

    await query(
      `INSERT INTO schedules (employee_id, store_id, work_date, shift_text, hours) VALUES ($1, $2, $3, '10-21', 11)`,
      [employeeA.id, storeA, WORK_DATE]
    );
  });

  afterAll(async () => {
    await query('DELETE FROM smart_alerts WHERE id = $1', [alertId]);
    await fx.cleanup();
  });

  // Регрессия: раньше можно было погасить чужой алерт, зная/угадав его id.
  it('POST /alerts/:id/ack — чужая сеть получает 403', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'POST', url: `/alerts/${alertId}/ack`, headers: authAs(managerB.telegramId) });
    expect(res.statusCode).toBe(403);
  });

  it('POST /alerts/:id/ack — своя сеть может погасить алерт', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'POST', url: `/alerts/${alertId}/ack`, headers: authAs(managerA.telegramId) });
    expect(res.statusCode).toBe(200);
  });

  // Регрессия: what-if тянул точки ВСЕХ сетей — можно было и посмотреть
  // покрытие чужой сети, и (через /apply) реально переставить чужого
  // сотрудника на любую чужую точку.
  it('POST /schedule/what-if — чужая точка не попадает в покрытие сценария', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/schedule/what-if',
      headers: { ...authAs(managerB.telegramId), 'content-type': 'application/json' },
      payload: { date: WORK_DATE, moves: [] }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.stores.find((s: any) => s.store_id === storeA)).toBeUndefined();
  });

  it('POST /schedule/what-if/apply — перенос чужого сотрудника на чужую точку не проходит', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/schedule/what-if/apply',
      headers: { ...authAs(managerB.telegramId), 'content-type': 'application/json' },
      payload: { date: WORK_DATE, moves: [{ employee_id: employeeA.id, to_store: storeB }] }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(0);
    expect(body.simulation.moves_applied[0].skipped).toBe(true);

    // и в БД реально ничего не поменялось — сотрудник A всё ещё на своей точке
    const check = await query(
      `SELECT store_id FROM schedules WHERE employee_id = $1 AND work_date = $2`,
      [employeeA.id, WORK_DATE]
    );
    expect(check.rows[0].store_id).toBe(storeA);
  });

  it('POST /schedule/what-if/apply — перенос внутри своей сети проходит', async () => {
    const app = await getApp();
    const storeA2 = await fx.createStore(orgA, 'A2');
    const res = await app.inject({
      method: 'POST',
      url: '/schedule/what-if/apply',
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { date: WORK_DATE, moves: [{ employee_id: employeeA.id, to_store: storeA2 }] }
    });
    const body = res.json();
    expect(body.count).toBe(1);
  });
});
