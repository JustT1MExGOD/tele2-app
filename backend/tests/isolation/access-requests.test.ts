import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

describe('Изоляция заявок на доступ (GET /access/requests)', () => {
  const fx = new TestFixtures();
  let orgA: string, orgB: string;
  let managerA: { id: number; telegramId: number };
  let managerB: { id: number; telegramId: number };
  let requestId: number;
  const guestTelegramId = Math.floor(9_000_000_000 + Math.random() * 900_000_000);

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A');
    orgB = await fx.createOrg('Org B');
    managerA = await fx.createEmployee(orgA, { role: 'manager' });
    managerB = await fx.createEmployee(orgB, { role: 'manager' });

    // Заявка гостя, выбравшего сеть B в публичном пикере при регистрации
    // (org_id пишется прямо на заявку, ещё до появления claimed_employee_id).
    const res = await query(
      `INSERT INTO access_requests (telegram_id, full_name, status, org_id)
       VALUES ($1, 'Test Guest', 'pending', $2) RETURNING id`,
      [guestTelegramId, orgB]
    );
    requestId = Number(res.rows[0].id);
  });

  afterAll(async () => {
    await query('DELETE FROM access_requests WHERE id = $1', [requestId]);
    await fx.cleanup();
  });

  it('manager чужой сети не видит заявку', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/access/requests', headers: authAs(managerA.telegramId) });
    const rows = res.json();
    expect(rows.find((r: any) => Number(r.id) === requestId)).toBeUndefined();
  });

  it('manager своей сети видит заявку', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/access/requests', headers: authAs(managerB.telegramId) });
    const rows = res.json();
    expect(rows.find((r: any) => Number(r.id) === requestId)).toBeDefined();
  });
});
