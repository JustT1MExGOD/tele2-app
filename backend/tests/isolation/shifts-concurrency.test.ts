import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

// Регрессия: гонки в /shifts/open и /shifts/close, найденные при разборе
// пункта «две параллельные операции с одной сменой не ломают состояние».
//
// close: SELECT открытой сессии и UPDATE её в 'closed' были двумя разными
// запросами — два параллельных close на ОДНУ и ту же сессию оба читали её
// как 'open' до того, как любой успевал закрыть, и оба награждали XP
// (проверка "уже награждён сегодня" сравнивала с ДРУГИМИ сессиями, id !=
// текущей, поэтому свою же гонку не ловила). Теперь UPDATE атомарный
// (WHERE id=$X AND status='open'), проигравший получает 0 строк и не
// награждается повторно.
//
// open: "закрыть висящие open" + INSERT новой не были атомарны — два
// параллельных open могли оба пройти UPDATE (ещё нет ни одной 'open'
// строки) и оба вставить свою — сотрудник с двумя одновременно открытыми
// сменами. Теперь partial unique index (employee_id) WHERE status='open'
// делает второй INSERT нелегальным, проигравший получает существующую
// открытую сессию победителя вместо ошибки/дубликата.
describe('Гонки в /shifts/open и /shifts/close', () => {
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

  it('два параллельных /shifts/open для одного сотрудника не создают два открытых сеанса', async () => {
    const app = await getApp();
    const [r1, r2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/shifts/open',
        headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
        payload: { store_id: storeA, work_date: '2026-06-01' }
      }),
      app.inject({
        method: 'POST',
        url: '/shifts/open',
        headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
        payload: { store_id: storeA, work_date: '2026-06-01' }
      })
    ]);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);

    const openRows = await query(
      `SELECT id FROM shift_sessions WHERE employee_id = $1 AND status = 'open'`,
      [employeeA.id]
    );
    expect(openRows.rows.length).toBe(1);
  });

  it('два параллельных /shifts/close на одну и ту же сессию награждают XP только один раз', async () => {
    const before = await query(`SELECT xp FROM employees WHERE id = $1`, [employeeA.id]);
    const xpBefore = Number(before.rows[0].xp);

    const app = await getApp();
    const [r1, r2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/shifts/close',
        headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
        payload: {}
      }),
      app.inject({
        method: 'POST',
        url: '/shifts/close',
        headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
        payload: {}
      })
    ]);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);

    const rewardedCount = [r1, r2].filter((r) => r.json().rewarded === true).length;
    expect(rewardedCount).toBe(1);
    const dedupedCount = [r1, r2].filter((r) => r.json().deduped === true).length;
    expect(dedupedCount).toBe(1);

    const after = await query(`SELECT xp FROM employees WHERE id = $1`, [employeeA.id]);
    expect(Number(after.rows[0].xp)).toBeGreaterThan(xpBefore);

    const closedRows = await query(
      `SELECT id FROM shift_sessions WHERE employee_id = $1 AND status = 'closed'`,
      [employeeA.id]
    );
    expect(closedRows.rows.length).toBe(1);
  });
});
