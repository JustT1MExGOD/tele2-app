import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/db/index.js';

/**
 * Изначально "свои" продажи/смену/график можно было писать на ЛЮБУЮ точку,
 * включая точку совершенно чужой сети — assertStoreInOrg вызывался ТОЛЬКО
 * когда пишущий явно указан как manager, вносящий продажу ЗА ДРУГОГО
 * сотрудника ("подмена" — легитимный сценарий "работал сегодня на чужой
 * точке своей же сети"), но НЕ когда сотрудник пишет "за себя" на точку,
 * которая может принадлежать вообще другой организации.
 *
 * Отдельно POST /schedules и /schedules/bulk проверяли, что STORE
 * принадлежит своей сети, но не проверяли EMPLOYEE — manager чужой сети
 * мог назначить сотрудника жертвы на смену и молча перезаписать (ON
 * CONFLICT DO UPDATE) его существующую смену на его собственной точке.
 *
 * Починено (routes-sales.ts, routes-shifts.ts, routes-schedules.ts):
 * assertStoreInOrg теперь проверяется для ВСЕХ записей, включая "свои"
 * (self-write), и assertEmployeeInOrg добавлен в /schedules и
 * /schedules/bulk. Заодно: значения метрик вне диапазона integer теперь
 * отклоняются 400 (SaleMetricRangeError, services/sales-write.ts), а не
 * роняют запрос необработанным 500.
 */
describe('CROSS-TENANT WRITE (ПОЧИНЕНО): запись "своих" продаж/смены/графика на чужую точку/сотрудника теперь блокируется', () => {
  const fx = new TestFixtures();
  let orgAttacker: string, orgVictim: string;
  let storeAttacker: string, storeVictim: string;
  let attacker: { id: number; telegramId: number };

  beforeAll(async () => {
    orgAttacker = await fx.createOrg('Attacker Org');
    orgVictim = await fx.createOrg('Victim Org CTW');
    storeVictim = await fx.createStore(orgVictim, 'Victim Store CTW');
    attacker = await fx.createEmployee(orgAttacker, { role: 'employee', fullName: 'Attacker Employee' });
    storeAttacker = await fx.createStore(orgAttacker, 'Attacker Own Store CTW');
  });

  afterAll(() => fx.cleanup());

  it('ПОЧИНЕНО: обычный employee чужой сети БОЛЬШЕ НЕ может внести "свою" продажу на точку жертвы (POST /sales) — 403', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { ...authAs(attacker.telegramId), 'content-type': 'application/json' },
      payload: {
        employee_id: attacker.id,
        store_id: storeVictim,
        sale_date: '2026-06-20',
        sim: 999
      }
    });
    expect(res.statusCode).toBe(403);
  });

  it('свою продажу на СВОЕЙ точке по-прежнему можно вносить как раньше', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { ...authAs(attacker.telegramId), 'content-type': 'application/json' },
      payload: {
        employee_id: attacker.id,
        store_id: storeAttacker,
        sale_date: '2026-06-20',
        sim: 5
      }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().store_id).toBe(storeAttacker);
  });

  it('ПОЧИНЕНО: integer-метрика (mnp) вне диапазона теперь отдаёт аккуратный 400, не голый 500', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { ...authAs(attacker.telegramId), 'content-type': 'application/json' },
      payload: {
        employee_id: attacker.id,
        store_id: storeAttacker,
        sale_date: '2026-06-24',
        mnp: 1_000_000_000_000
      }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('metric_out_of_range');
  });

  it('ПОЧИНЕНО: абсурдно большая numeric-метрика (1e15 accessories) теперь тоже отклоняется — единый потолок для всех метрик, не только integer-колонок', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { ...authAs(attacker.telegramId), 'content-type': 'application/json' },
      payload: {
        employee_id: attacker.id,
        store_id: storeAttacker,
        sale_date: '2026-06-21',
        accessories: 1_000_000_000_000_000
      }
    });
    expect(res.statusCode).toBe(400);
  });

  it('ПОЧИНЕНО: обычный employee БОЛЬШЕ НЕ может открыть смену на точке чужой сети (POST /shifts/open) — 403', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/shifts/open',
      headers: { ...authAs(attacker.telegramId), 'content-type': 'application/json' },
      payload: { store_id: storeVictim, work_date: '2026-06-22' }
    });
    expect(res.statusCode).toBe(403);
  });

  it('ПОЧИНЕНО: manager БОЛЬШЕ НЕ может назначить/перезаписать смену сотрудника ЧУЖОЙ сети через POST /schedules — 403, оригинальная смена жертвы не тронута', async () => {
    const app = await getApp();
    const victimEmployee = await fx.createEmployee(orgVictim, { role: 'employee', fullName: 'Victim Employee CTW' });
    const attackerManager = await fx.createEmployee(orgAttacker, { role: 'manager' });

    // жертва изначально стоит в графике на СВОЕЙ точке своей сети
    await query(
      `INSERT INTO schedules (employee_id, store_id, work_date, shift_text, hours) VALUES ($1,$2,$3,$4,$5)`,
      [victimEmployee.id, storeVictim, '2026-06-23', '10-21', 11]
    );

    const res = await app.inject({
      method: 'POST',
      url: '/schedules',
      headers: { ...authAs(attackerManager.telegramId), 'content-type': 'application/json' },
      payload: {
        employee_id: victimEmployee.id,
        store_id: storeAttacker,
        work_date: '2026-06-23',
        shift_text: 'HIJACKED',
        hours: 11
      }
    });
    expect(res.statusCode).toBe(403);

    // Оригинальная смена жертвы на своей точке НЕ перезаписана.
    const check = await query(
      `SELECT store_id FROM schedules WHERE employee_id = $1 AND work_date = $2`,
      [victimEmployee.id, '2026-06-23']
    );
    expect(check.rows[0].store_id).toBe(storeVictim);
  });
});
