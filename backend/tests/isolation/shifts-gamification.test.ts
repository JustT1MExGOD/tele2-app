import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

// Регрессия: ни /shifts/open, ни /shifts/close ничем не ограничены по
// количеству вызовов в день — до фикса каждый close начислял полную
// награду (XP + streak_days + бейджи) заново, независимо от того, сколько
// раз этот же сотрудник уже открывал/закрывал смену в этот же
// календарный день. Бесконечный фарм XP/уровней/streak без единой
// реальной продажи, просто спамом одной кнопки.
describe('Гейт на награду за закрытие смены (не более раза в день)', () => {
  const fx = new TestFixtures();
  let orgA: string;
  let storeA: string;
  let employeeA: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A');
    storeA = await fx.createStore(orgA);
    employeeA = await fx.createEmployee(orgA, { role: 'employee' });
  });

  afterAll(async () => {
    await query(`DELETE FROM shift_sessions WHERE employee_id = $1`, [employeeA.id]);
    await query(`DELETE FROM xp_events WHERE employee_id = $1`, [employeeA.id]);
    await query(`DELETE FROM employee_badges WHERE employee_id = $1`, [employeeA.id]);
    await fx.cleanup();
  });

  // Дата зафиксирована явно (а не todayMoscow()) — иначе тест становится
  // флейки ровно вокруг полуночи по МСК: два open()/close() подряд могут
  // попасть на разные календарные дни, и тогда "не награждается второй
  // раз" не воспроизводится не из-за бага, а из-за реальной смены суток
  // между двумя вызовами теста.
  const WORK_DATE = '2026-05-15';

  async function openAndClose() {
    const app = await getApp();
    await app.inject({
      method: 'POST',
      url: '/shifts/open',
      headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
      payload: { store_id: storeA, work_date: WORK_DATE }
    });
    return app.inject({
      method: 'POST',
      url: '/shifts/close',
      headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
      payload: {}
    });
  }

  it('первое закрытие смены за день награждается', async () => {
    const res = await openAndClose();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rewarded).toBe(true);
    expect(body.gamification.xp_gained).toBeGreaterThan(0);
  });

  it('повторное открытие+закрытие в тот же день НЕ награждается второй раз', async () => {
    const before = await query(`SELECT xp, streak_days FROM employees WHERE id = $1`, [employeeA.id]);
    const xpBefore = Number(before.rows[0].xp);
    const streakBefore = Number(before.rows[0].streak_days);

    const res = await openAndClose();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rewarded).toBe(false);
    expect(body.gamification.xp_gained).toBe(0);

    const after = await query(`SELECT xp, streak_days FROM employees WHERE id = $1`, [employeeA.id]);
    expect(Number(after.rows[0].xp)).toBe(xpBefore);
    expect(Number(after.rows[0].streak_days)).toBe(streakBefore);
  });

  it('третье открытие+закрытие в тот же день тоже не награждается — гейт не одноразовый', async () => {
    const before = await query(`SELECT xp FROM employees WHERE id = $1`, [employeeA.id]);
    const xpBefore = Number(before.rows[0].xp);

    const res = await openAndClose();
    expect(res.json().rewarded).toBe(false);

    const after = await query(`SELECT xp FROM employees WHERE id = $1`, [employeeA.id]);
    expect(Number(after.rows[0].xp)).toBe(xpBefore);
  });

  it('смена всё равно закрывается нормально (score/факт считаются) даже без награды', async () => {
    const res = await openAndClose();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.session.status).toBe('closed');
    expect(body.fact).toBeDefined();
    expect(typeof body.score).toBe('number');
  });
});
