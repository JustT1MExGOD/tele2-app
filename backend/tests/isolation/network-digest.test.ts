import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import { todayMoscow } from '../../src/utils/date.js';
import { buildNetworkDigestText, sendNetworkDigest } from '../../src/core/analytics/network-digest.js';

// 18.9 Reports — недельная/месячная сводка по сети. Не новый расчётный
// движок (buildSupervisorDashboard уже даёт план/факт/тренд), только
// форматирование + claim-дедуп рассылки. Атомарность самого claimCronSend
// уже покрыта tests/unit/cron-idempotency.test.ts — здесь проверяем, что
// sendNetworkDigest реально использует claim (а bypassClaim реально его
// обходит), и что текст сводки честно скопирован по своей сети.
describe('Reports — недельная/месячная сводка по сети', () => {
  const fx = new TestFixtures();
  let orgA: string, orgB: string;
  let storeA: string, storeB: string;
  let managerA: { id: number; telegramId: number };
  let employeeA: { id: number; telegramId: number };
  let employeeB: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Сеть А');
    orgB = await fx.createOrg('Сеть Б');
    storeA = await fx.createStore(orgA, 'Точка А');
    storeB = await fx.createStore(orgB, 'Точка Б');
    managerA = await fx.createEmployee(orgA, { role: 'manager' });
    employeeA = await fx.createEmployee(orgA, { role: 'employee' });
    employeeB = await fx.createEmployee(orgB, { role: 'employee' });

    const month = todayMoscow().slice(0, 7) + '-01';
    await query(
      `INSERT INTO employee_month_plans (employee_id, month, sim) VALUES ($1, $2, 10)`,
      [employeeA.id, month]
    );
    await query(
      `INSERT INTO employee_month_plans (employee_id, month, sim) VALUES ($1, $2, 10)`,
      [employeeB.id, month]
    );
    await query(
      `INSERT INTO schedules (employee_id, store_id, work_date, hours) VALUES ($1,$2,$3,8)`,
      [employeeA.id, storeA, todayMoscow()]
    );
    await query(
      `INSERT INTO schedules (employee_id, store_id, work_date, hours) VALUES ($1,$2,$3,8)`,
      [employeeB.id, storeB, todayMoscow()]
    );
    // Сеть А продаёт, сеть Б — нет: сводки не должны путать чужие числа.
    await query(
      `INSERT INTO sales (employee_id, store_id, sale_date, sim) VALUES ($1,$2,$3,5)`,
      [employeeA.id, storeA, todayMoscow()]
    );
  });

  afterAll(async () => {
    await query(`DELETE FROM cron_send_log WHERE key LIKE 'digest:%'`);
    await query(`DELETE FROM employee_month_plans WHERE employee_id = ANY($1)`, [[employeeA.id, employeeB.id]]);
    await fx.cleanup();
  });

  it('сводка сети А содержит её план/факт и не содержит нулевых чужих данных из сети Б', async () => {
    const text = await buildNetworkDigestText(orgA, 7, 'неделя');
    expect(text).toBeTruthy();
    expect(text).toContain('Сеть А');
    expect(text).toContain('Точка А');
    expect(text).not.toContain('Точка Б');
  });

  it('сеть без активных точек — null (нечего отправлять)', async () => {
    const emptyOrg = await fx.createOrg('Пустая сеть');
    const text = await buildNetworkDigestText(emptyOrg, 7, 'неделя');
    expect(text).toBeNull();
  });

  it('sendNetworkDigest без bypassClaim реально клеймит ключ — повторный вызов той же сети/периода не создаёт вторую запись', async () => {
    await query(`DELETE FROM cron_send_log WHERE key LIKE 'digest:weekly:' || $1 || ':%'`, [orgA]);
    await sendNetworkDigest('weekly', { orgId: orgA });
    await sendNetworkDigest('weekly', { orgId: orgA });
    const rows = await query(`SELECT key FROM cron_send_log WHERE key LIKE 'digest:weekly:' || $1 || ':%'`, [orgA]);
    expect(rows.rows.length).toBe(1);
  });

  it('sendNetworkDigest c bypassClaim не трогает cron_send_log (ручная кнопка не участвует в claim)', async () => {
    await query(`DELETE FROM cron_send_log WHERE key LIKE 'digest:monthly:' || $1 || ':%'`, [orgA]);
    await sendNetworkDigest('monthly', { orgId: orgA, bypassClaim: true });
    const rows = await query(`SELECT key FROM cron_send_log WHERE key LIKE 'digest:monthly:' || $1 || ':%'`, [orgA]);
    expect(rows.rows.length).toBe(0);
  });

  it('POST /reports/send-digest требует manager', async () => {
    const app = await getApp();
    const noAuth = await app.inject({ method: 'POST', url: '/reports/send-digest', payload: { kind: 'weekly' } });
    expect(noAuth.statusCode).toBe(401);

    const asEmployee = await app.inject({
      method: 'POST',
      url: '/reports/send-digest',
      headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
      payload: { kind: 'weekly' }
    });
    expect(asEmployee.statusCode).toBe(403);

    const asManager = await app.inject({
      method: 'POST',
      url: '/reports/send-digest',
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { kind: 'weekly' }
    });
    expect(asManager.statusCode).toBe(200);
    expect(asManager.json().ok).toBe(true);
  });
});
