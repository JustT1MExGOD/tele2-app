import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import { todayMoscow } from '../../src/utils/date.js';

// 18.8 Employee 2.0 — профиль сотрудника + объяснимый Employee Health
// Score, собранный из уже существующих BFQ/геймификации/истории смен, а
// не новый расчётный движок. Даты считаем в МСК (todayMoscow), тем же
// способом, что бэкенд — та же осторожность, что уже ловила расхождение
// в store-profile.test.ts (18.5).
describe('GET /employees/:id/profile', () => {
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
    employeeA = await fx.createEmployee(orgA, { role: 'employee', fullName: 'Тестовый Сотрудник' });

    const month = todayMoscow().slice(0, 7) + '-01';
    // Только план по sim ненулевой — pct для health.plan становится
    // однозначным (7 факт / 10 план = 70%), не усредняется по 13 метрикам.
    await query(
      `INSERT INTO employee_month_plans (employee_id, month, sim, mnp, pa, combo)
       VALUES ($1, $2, 10, 0, 0, 0)`,
      [employeeA.id, month]
    );

    const todayStr0 = todayMoscow();
    for (let i = 0; i < 7; i++) {
      const d = new Date(todayStr0 + 'T12:00:00');
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      await query(
        `INSERT INTO schedules (employee_id, store_id, work_date, hours) VALUES ($1,$2,$3,8)`,
        [employeeA.id, storeA, dateStr]
      );
      await query(
        `INSERT INTO sales (employee_id, store_id, sale_date, sim) VALUES ($1,$2,$3,1)`,
        [employeeA.id, storeA, dateStr]
      );
      // Только 5 из 7 запланированных дней реально отработаны (закрытая
      // смена) — 2 дня отсутствуют, явка должна получиться 5/7 ≈ 71%.
      // Из 5 отработанных 3 идеальные — ideal_rate должен получиться 60%.
      if (i < 5) {
        await query(
          `INSERT INTO shift_sessions (employee_id, store_id, work_date, status, opened_at, closed_at, score, ideal_shift, mood)
           VALUES ($1, $2, $3, 'closed', now(), now(), 50, $4, 4)`,
          [employeeA.id, storeA, dateStr, i < 3]
        );
      }
    }

    await query(
      `UPDATE employees SET xp = 500, streak_days = 7, best_shift_score = 80 WHERE id = $1`,
      [employeeA.id]
    );
  });

  afterAll(async () => {
    await query(`DELETE FROM shift_sessions WHERE employee_id = $1`, [employeeA.id]);
    await query(`DELETE FROM employee_month_plans WHERE employee_id = $1`, [employeeA.id]);
    await query(`DELETE FROM xp_events WHERE employee_id = $1`, [employeeA.id]);
    await query(`DELETE FROM employee_badges WHERE employee_id = $1`, [employeeA.id]);
    await fx.cleanup();
  });

  it('без токена — 401', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: `/employees/${employeeA.id}/profile` });
    expect(res.statusCode).toBe(401);
  });

  it('manager другой сети получает 403', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/employees/${employeeA.id}/profile`,
      headers: authAs(managerB.telegramId)
    });
    expect(res.statusCode).toBe(403);
  });

  it('обычный сотрудник (не manager/supervisor/admin) не может открыть чужой профиль', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/employees/${employeeA.id}/profile`,
      headers: authAs(employeeA.telegramId)
    });
    expect(res.statusCode).toBe(403);
  });

  it('manager своей сети получает профиль с объяснимым Health Score', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/employees/${employeeA.id}/profile?days=7`,
      headers: authAs(managerA.telegramId)
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Number(body.employee.id)).toBe(employeeA.id);
    expect(body.employee.full_name).toBe('Тестовый Сотрудник');

    expect(typeof body.health.score).toBe('number');
    expect(body.health.score).toBeGreaterThanOrEqual(0);
    expect(body.health.score).toBeLessThanOrEqual(100);

    // Веса компонент в сумме дают 1 — объяснимая композиция, не
    // произвольное число.
    const weightSum = Object.values(body.health.components).reduce(
      (s: number, c: any) => s + c.weight, 0
    );
    expect(weightSum).toBeCloseTo(1, 5);

    expect(body.health.components.plan.value).toBe(70);
    expect(body.health.components.attendance.value).toBe(71);
    expect(body.health.components.ideal_shift_rate.value).toBe(60);
    expect(body.health.components.momentum.value).toBe(100);

    expect(body.bfq.employee_id).toBe(employeeA.id);
    expect(body.gamification.streak_days).toBe(7);
    expect(body.gamification.best_shift_score).toBe(80);

    expect(body.shifts.recent.length).toBe(5);
    expect(body.shifts.ideal_rate).toBe(60);
  });

  it('несуществующий сотрудник своей сети — 403 (не проходит org-check раньше 404)', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/employees/999999999/profile`,
      headers: authAs(managerA.telegramId)
    });
    expect(res.statusCode).toBe(403);
  });
});
