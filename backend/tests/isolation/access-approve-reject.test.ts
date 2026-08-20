import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/db/index.js';

// Регрессия: GET /access/requests уже фильтровался по сети, но сам
// approve/reject это не перепроверял — manager одной сети, зная/угадав id
// заявки другой сети, мог одобрить/отклонить её напрямую через API, в
// обход отфильтрованного списка (в т.ч. выдать себе доступ к чужой сети).
describe('Изоляция одобрения/отклонения заявок на доступ', () => {
  const fx = new TestFixtures();
  let orgA: string, orgB: string;
  let managerA: { id: number; telegramId: number };
  let managerB: { id: number; telegramId: number };
  let requestIdA: number;
  let requestIdB: number;
  const guestTgA = Math.floor(9_000_000_000 + Math.random() * 900_000_000);
  const guestTgB = Math.floor(9_000_000_000 + Math.random() * 900_000_000);

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A');
    orgB = await fx.createOrg('Org B');
    managerA = await fx.createEmployee(orgA, { role: 'manager' });
    managerB = await fx.createEmployee(orgB, { role: 'manager' });

    const ra = await query(
      `INSERT INTO access_requests (telegram_id, full_name, status, org_id) VALUES ($1, 'Guest A', 'pending', $2) RETURNING id`,
      [guestTgA, orgA]
    );
    requestIdA = ra.rows[0].id;
    const rb = await query(
      `INSERT INTO access_requests (telegram_id, full_name, status, org_id) VALUES ($1, 'Guest B', 'pending', $2) RETURNING id`,
      [guestTgB, orgB]
    );
    requestIdB = rb.rows[0].id;
  });

  afterAll(async () => {
    await query('DELETE FROM access_requests WHERE id = ANY($1)', [[requestIdA, requestIdB]]);
    await fx.cleanup();
  });

  it('approve — чужая сеть получает 403 на заявку другой сети', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: `/access/requests/${requestIdA}/approve`,
      headers: { ...authAs(managerB.telegramId), 'content-type': 'application/json' },
      payload: {}
    });
    expect(res.statusCode).toBe(403);
  });

  it('reject — чужая сеть получает 403 на заявку другой сети', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: `/access/requests/${requestIdB}/reject`,
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: {}
    });
    expect(res.statusCode).toBe(403);
  });

  it('approve — своя сеть может одобрить свою заявку', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: `/access/requests/${requestIdA}/approve`,
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: {}
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    fx.employeeIds.push(body.employee_id);
  });
});
