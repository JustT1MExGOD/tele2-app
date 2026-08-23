import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

// Shift 2.0 (18.7): смена как объект с фазами «до/во время/после» вместо
// пары timestamp'ов. Проверяем три вещи, которых раньше не было вообще:
// 1) передача (handover_note) от закрытой смены видна следующему, кто
//    откроет смену на ТОЙ ЖЕ точке (любой сотрудник), и не видна на чужой
//    точке; 2) незакрытые задачи сотрудника попадают в бриф открытия;
// 3) живой план/факт на /shifts/current той же формулой, что финальный
// на /shifts/close.
describe('Shift 2.0 — handover, брифинг задач, живой план/факт', () => {
  const fx = new TestFixtures();
  let orgA: string;
  let storeA: string;
  let storeB: string;
  let empA1: { id: number; telegramId: number };
  let empA2: { id: number; telegramId: number };
  let empB: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A');
    storeA = await fx.createStore(orgA, 'Store A');
    storeB = await fx.createStore(orgA, 'Store B');
    empA1 = await fx.createEmployee(orgA, { role: 'employee', fullName: 'Сотрудник Раз' });
    empA2 = await fx.createEmployee(orgA, { role: 'employee', fullName: 'Сотрудник Два' });
    empB = await fx.createEmployee(orgA, { role: 'employee', fullName: 'Сотрудник Три' });
  });

  afterAll(async () => {
    const empIds = [empA1.id, empA2.id, empB.id];
    await query(`DELETE FROM task_comments WHERE task_id IN (SELECT id FROM tasks WHERE assigned_to = ANY($1))`, [empIds]);
    await query(`DELETE FROM tasks WHERE assigned_to = ANY($1)`, [empIds]);
    await query(`DELETE FROM shift_sessions WHERE employee_id = ANY($1)`, [empIds]);
    await query(`DELETE FROM employee_month_plans WHERE employee_id = ANY($1)`, [empIds]);
    await query(`DELETE FROM xp_events WHERE employee_id = ANY($1)`, [empIds]);
    await query(`DELETE FROM employee_badges WHERE employee_id = ANY($1)`, [empIds]);
    await fx.cleanup();
  });

  it('handover_note от закрытой смены виден следующему открывающему на ТОЙ ЖЕ точке', async () => {
    const app = await getApp();

    const openR1 = await app.inject({
      method: 'POST',
      url: '/shifts/open',
      headers: { ...authAs(empA1.telegramId), 'content-type': 'application/json' },
      payload: { store_id: storeA, work_date: '2026-06-01' }
    });
    expect(openR1.statusCode).toBe(200);
    expect(openR1.json().handover).toBeNull();

    const closeR1 = await app.inject({
      method: 'POST',
      url: '/shifts/close',
      headers: { ...authAs(empA1.telegramId), 'content-type': 'application/json' },
      payload: { handover_note: 'Касса сходится, но проверить остаток sim-карт' }
    });
    expect(closeR1.statusCode).toBe(200);

    const openR2 = await app.inject({
      method: 'POST',
      url: '/shifts/open',
      headers: { ...authAs(empA2.telegramId), 'content-type': 'application/json' },
      payload: { store_id: storeA, work_date: '2026-06-02' }
    });
    expect(openR2.statusCode).toBe(200);
    const handover = openR2.json().handover;
    expect(handover?.handover_note).toBe('Касса сходится, но проверить остаток sim-карт');
    expect(handover?.from_employee_name).toBe('Сотрудник Раз');

    await app.inject({
      method: 'POST',
      url: '/shifts/close',
      headers: { ...authAs(empA2.telegramId), 'content-type': 'application/json' },
      payload: {}
    });
  });

  it('handover с чужой точки не виден', async () => {
    const app = await getApp();
    const openR = await app.inject({
      method: 'POST',
      url: '/shifts/open',
      headers: { ...authAs(empB.telegramId), 'content-type': 'application/json' },
      payload: { store_id: storeB, work_date: '2026-06-01' }
    });
    expect(openR.statusCode).toBe(200);
    expect(openR.json().handover).toBeNull();

    await app.inject({
      method: 'POST',
      url: '/shifts/close',
      headers: { ...authAs(empB.telegramId), 'content-type': 'application/json' },
      payload: {}
    });
  });

  it('открытые задачи сотрудника попадают в бриф открытия и отфильтрованы по исполнителю', async () => {
    await query(
      `INSERT INTO tasks (org_id, title, created_by, assigned_to, status)
       VALUES ($1, 'Проверить витрину', $2, $3, 'open'), ($1, 'Чужая задача', $2, $4, 'open')`,
      [orgA, empA1.id, empA1.id, empA2.id]
    );

    const app = await getApp();
    const openR = await app.inject({
      method: 'POST',
      url: '/shifts/open',
      headers: { ...authAs(empA1.telegramId), 'content-type': 'application/json' },
      payload: { store_id: storeA, work_date: '2026-06-03' }
    });
    expect(openR.statusCode).toBe(200);
    const tasks = openR.json().open_tasks;
    expect(tasks.length).toBe(1);
    expect(tasks[0].title).toBe('Проверить витрину');

    await app.inject({
      method: 'POST',
      url: '/shifts/close',
      headers: { ...authAs(empA1.telegramId), 'content-type': 'application/json' },
      payload: {}
    });
  });

  it('живой план/факт на /shifts/current совпадает с итоговым на /shifts/close', async () => {
    const date = '2026-06-04';
    const month = '2026-06-01';
    await query(
      `INSERT INTO employee_month_plans (employee_id, month, sim, mnp, pa, combo)
       VALUES ($1, $2, 10, 4, 2, 1)`,
      [empA1.id, month]
    );
    await query(
      `INSERT INTO schedules (employee_id, store_id, work_date, hours) VALUES ($1, $2, $3, 8)`,
      [empA1.id, storeA, date]
    );

    const app = await getApp();
    await app.inject({
      method: 'POST',
      url: '/shifts/open',
      headers: { ...authAs(empA1.telegramId), 'content-type': 'application/json' },
      payload: { store_id: storeA, work_date: date }
    });

    const beforeSale = await app.inject({
      method: 'GET',
      url: '/shifts/current',
      headers: authAs(empA1.telegramId)
    });
    expect(beforeSale.statusCode).toBe(200);
    expect(beforeSale.json().day_plan.sim).toBe(10);
    expect(beforeSale.json().fact.sim).toBe(0);

    await query(
      `INSERT INTO sales (employee_id, store_id, sale_date, sim, mnp, pa, combo)
       VALUES ($1, $2, $3, 3, 0, 0, 0)`,
      [empA1.id, storeA, date]
    );

    const afterSale = await app.inject({
      method: 'GET',
      url: '/shifts/current',
      headers: authAs(empA1.telegramId)
    });
    expect(afterSale.json().fact.sim).toBe(3);
    expect(afterSale.json().day_plan.sim).toBe(10);

    const closeR = await app.inject({
      method: 'POST',
      url: '/shifts/close',
      headers: { ...authAs(empA1.telegramId), 'content-type': 'application/json' },
      payload: {}
    });
    expect(closeR.json().fact.sim).toBe(3);
    expect(closeR.json().day_plan.sim).toBe(10);
  });
});
