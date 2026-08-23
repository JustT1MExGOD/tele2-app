import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

describe('Изоляция графика смен (/schedules)', () => {
  const fx = new TestFixtures();
  const WORK_DATE = '2026-06-15'; // фиксированная дата, не пересекается с реальными данными
  let orgA: string, orgB: string;
  let storeA: string, storeB: string;
  let managerA: { id: number; telegramId: number };
  let managerB: { id: number; telegramId: number };
  let employeeA: { id: number; telegramId: number };
  let employeeB: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A');
    orgB = await fx.createOrg('Org B');
    storeA = await fx.createStore(orgA);
    storeB = await fx.createStore(orgB);
    managerA = await fx.createEmployee(orgA, { role: 'manager' });
    managerB = await fx.createEmployee(orgB, { role: 'manager' });
    employeeA = await fx.createEmployee(orgA, { role: 'employee' });
    employeeB = await fx.createEmployee(orgB, { role: 'employee' });

    // employeeA — обычная смена на своей точке
    await query(
      `INSERT INTO schedules (employee_id, store_id, work_date, shift_text, hours) VALUES ($1, $2, $3, '10-21', 11)`,
      [employeeA.id, storeA, WORK_DATE]
    );
    // employeeB подменяет на точке чужой сети (storeA) — вставляем напрямую в
    // БД, т.к. сам POST /schedules это теперь блокирует (см. ниже) — здесь
    // проверяем поведение GET на уже существующей "подменной" записи.
    await query(
      `INSERT INTO schedules (employee_id, store_id, work_date, shift_text, hours) VALUES ($1, $2, $3, '10-21', 11)`,
      [employeeB.id, storeA, WORK_DATE]
    );
  });

  afterAll(() => fx.cleanup());

  it('POST /schedules на точку чужой сети — 403', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/schedules',
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { employee_id: employeeA.id, store_id: storeB, work_date: WORK_DATE, shift_text: '10-21', hours: 11 }
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST /schedules на точку своей сети — проходит', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/schedules',
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { employee_id: employeeA.id, store_id: storeA, work_date: '2026-06-16', shift_text: '10-21', hours: 11 }
    });
    expect(res.statusCode).toBe(200);
  });

  it('GET /schedules — manager чужой сети не видит смены на точке другой сети', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/schedules?date=${WORK_DATE}`,
      headers: authAs(managerB.telegramId)
    });
    const rows = res.json();
    expect(rows.find((r: any) => Number(r.employee_id) === employeeA.id)).toBeUndefined();
  });

  it('GET /schedules — manager своей сети видит смены на своей точке', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/schedules?date=${WORK_DATE}`,
      headers: authAs(managerA.telegramId)
    });
    const rows = res.json();
    expect(rows.find((r: any) => Number(r.employee_id) === employeeA.id)).toBeDefined();
  });

  it('GET /schedules — сотрудник видит СВОЮ смену, даже если точка чужой сети (подмена)', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/schedules?date=${WORK_DATE}`,
      headers: authAs(employeeB.telegramId)
    });
    const rows = res.json();
    expect(rows.find((r: any) => Number(r.employee_id) === employeeB.id)).toBeDefined();
  });

  it('GET /schedules — manager своей сети (не сам подменяющий) НЕ видит чужую подменную смену', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/schedules?date=${WORK_DATE}`,
      headers: authAs(managerB.telegramId)
    });
    const rows = res.json();
    expect(rows.find((r: any) => Number(r.employee_id) === employeeB.id)).toBeUndefined();
  });

  // Регрессия: DELETE /schedules был вообще без проверки сети — manager
  // любой сети мог удалить смену любого сотрудника на любую дату.
  it('DELETE /schedules — чужая сеть получает 403', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/schedules?employee_id=${employeeA.id}&work_date=2026-06-16`,
      headers: authAs(managerB.telegramId)
    });
    expect(res.statusCode).toBe(403);
  });

  it('DELETE /schedules — своя сеть может удалить смену', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/schedules?employee_id=${employeeA.id}&work_date=2026-06-16`,
      headers: authAs(managerA.telegramId)
    });
    expect(res.statusCode).toBe(200);
  });
});
