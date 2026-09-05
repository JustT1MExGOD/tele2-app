import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import { toDateISO } from '../../src/utils/date.js';

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

  // Регрессия (hotfix 20.57.1, finding #6): store_id IS NULL — легитимное
  // переходное состояние (см. findByMonthForOrgOrSelf, LEFT JOIN на
  // stores) — раньше findStoreIdFor() возвращал null для ЭТОГО случая
  // неотличимо от "смены вообще нет", и DELETE пропускал org-scope
  // проверку целиком: manager ЛЮБОЙ сети мог удалить storeless-смену
  // сотрудника чужой сети.
  describe('DELETE /schedules — store_id IS NULL (переходное состояние без точки)', () => {
    const NULL_STORE_DATE = '2026-06-20';

    beforeAll(async () => {
      await query(
        `INSERT INTO schedules (employee_id, store_id, work_date, shift_text, hours) VALUES ($1, NULL, $2, '10-21', 11)`,
        [employeeA.id, NULL_STORE_DATE]
      );
    });

    it('чужая сеть получает 403, смена НЕ удаляется', async () => {
      const app = await getApp();
      const res = await app.inject({
        method: 'DELETE',
        url: `/schedules?employee_id=${employeeA.id}&work_date=${NULL_STORE_DATE}`,
        headers: authAs(managerB.telegramId)
      });
      expect(res.statusCode).toBe(403);
      const check = await query(`SELECT 1 FROM schedules WHERE employee_id = $1 AND work_date = $2`, [employeeA.id, NULL_STORE_DATE]);
      expect(check.rows.length).toBe(1);
    });

    it('своя сеть (сеть сотрудника) может удалить storeless-смену', async () => {
      const app = await getApp();
      const res = await app.inject({
        method: 'DELETE',
        url: `/schedules?employee_id=${employeeA.id}&work_date=${NULL_STORE_DATE}`,
        headers: authAs(managerA.telegramId)
      });
      expect(res.statusCode).toBe(200);
      const check = await query(`SELECT 1 FROM schedules WHERE employee_id = $1 AND work_date = $2`, [employeeA.id, NULL_STORE_DATE]);
      expect(check.rows.length).toBe(0);
    });
  });

  // Несуществующая смена — поведение не меняется (200, no-op), с чеком
  // работы не связано.
  it('DELETE /schedules — смены не существует — 200 no-op, без 403 (не путается с null-store-id случаем)', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/schedules?employee_id=${employeeB.id}&work_date=2099-01-01`,
      headers: authAs(managerA.telegramId)
    });
    expect(res.statusCode).toBe(200);
  });

  // Регрессия (hotfix 20.57.1, finding #7): INNER JOIN у GET /schedules
  // (дневной вид) против LEFT JOIN у GET /schedules/month — storeless-смена
  // (store_id IS NULL, легитимное переходное состояние) была видна в
  // месячном виде, но пропадала из дневного — та же строка данных вела
  // себя по-разному в зависимости от того, какой эндпоинт её показывает.
  describe('GET /schedules vs /schedules/month — консистентность для store_id IS NULL', () => {
    const NULL_STORE_DATE_2 = '2026-06-21';

    beforeAll(async () => {
      await query(
        `INSERT INTO schedules (employee_id, store_id, work_date, shift_text, hours) VALUES ($1, NULL, $2, '10-21', 11)`,
        [employeeA.id, NULL_STORE_DATE_2]
      );
    });

    it('GET /schedules (дневной) показывает storeless-смену своей сети — не вырезается INNER JOIN', async () => {
      const app = await getApp();
      const res = await app.inject({
        method: 'GET',
        url: `/schedules?date=${NULL_STORE_DATE_2}`,
        headers: authAs(managerA.telegramId)
      });
      const rows = res.json();
      expect(rows.find((r: any) => Number(r.employee_id) === employeeA.id)).toBeDefined();
    });

    it('GET /schedules/month показывает ту же storeless-смену (уже было LEFT JOIN)', async () => {
      const app = await getApp();
      const res = await app.inject({
        method: 'GET',
        url: `/schedules/month?month=2026-06`,
        headers: authAs(managerA.telegramId)
      });
      const items = res.json().items;
      // toDateISO(), не startsWith() на сырой JSON-строке: work_date уходит по
      // проводу как Date → JSON (всегда UTC-ISO), а pg распарсил колонку
      // типа date как полночь ПО ЛОКАЛЬНОМУ времени процесса — вне UTC-окружения
      // (CI — ubuntu, TZ=UTC) startsWith() ловит сдвиг на день и ложно падает.
      expect(items.find((r: any) => Number(r.employee_id) === employeeA.id && toDateISO(new Date(r.work_date)) === NULL_STORE_DATE_2)).toBeDefined();
    });
  });
});
