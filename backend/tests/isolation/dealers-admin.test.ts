/**
 * Дилеры/Секторы (21.x, «максимально функциональный» admin) — раньше
 * дилер/сектор заводились только неявно свободным текстом на форме сети,
 * не было вообще GET-all эндпоинта, не было переименования. Тесты на
 * дерево GET /admin/dealers (дилер → секторы → сети/супервайзеры,
 * непривязанные секторы/супервайзеры в отдельных хвостах) и на
 * PATCH-переименование дилера/сектора.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

describe('Дилеры/Секторы (GET /admin/dealers, PATCH /admin/dealers/:id, PATCH /admin/sectors/:id)', () => {
  const fx = new TestFixtures();
  let orgA: string;
  let admin: { id: number; telegramId: number };
  let manager: { id: number; telegramId: number };
  let supervisorAssigned: { id: number; telegramId: number };
  let supervisorUnassigned: { id: number; telegramId: number };
  let dealerId: number;
  const sectorAssignedId = `t21_sector_assigned_${Date.now()}`;
  const sectorUnassignedId = `t21_sector_unassigned_${Date.now()}`;

  beforeAll(async () => {
    orgA = await fx.createOrg('Dealers Test Org');
    admin = await fx.createEmployee(orgA, { role: 'admin' });
    manager = await fx.createEmployee(orgA, { role: 'manager' });
    supervisorAssigned = await fx.createEmployee(orgA, { role: 'supervisor', fullName: 'Supervisor Assigned' });
    supervisorUnassigned = await fx.createEmployee(orgA, { role: 'supervisor', fullName: 'Supervisor Unassigned' });

    const dealerRes = await query(`INSERT INTO dealers (name) VALUES ($1) RETURNING id`, [`t21_dealer_${Date.now()}`]);
    dealerId = Number(dealerRes.rows[0].id);

    await query(`INSERT INTO sectors (id, name, dealer_id) VALUES ($1, $1, $2)`, [sectorAssignedId, dealerId]);
    await query(`INSERT INTO sectors (id, name) VALUES ($1, $1)`, [sectorUnassignedId]); // dealer_id остаётся NULL

    await query(`UPDATE organizations SET sector_id = $1 WHERE id = $2`, [sectorAssignedId, orgA]);
    await query(`INSERT INTO supervisor_sectors (supervisor_id, sector_id) VALUES ($1, $2)`, [supervisorAssigned.id, sectorAssignedId]);
    // supervisorUnassigned намеренно без строки в supervisor_sectors.
  });

  afterAll(async () => {
    await query(`DELETE FROM supervisor_sectors WHERE sector_id = ANY($1)`, [[sectorAssignedId, sectorUnassignedId]]);
    await fx.cleanup(); // сначала сотрудники/сеть — освобождает FK на sectors
    await query(`DELETE FROM sectors WHERE id = ANY($1)`, [[sectorAssignedId, sectorUnassignedId]]);
    await query(`DELETE FROM dealers WHERE id = $1`, [dealerId]);
  });

  it('GET /admin/dealers — не admin получает 403', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/admin/dealers', headers: authAs(manager.telegramId) });
    expect(res.statusCode).toBe(403);
  });

  it('GET /admin/dealers — строит дерево дилер → сектор → сети/супервайзеры, непривязанное — в отдельных хвостах', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/admin/dealers', headers: authAs(admin.telegramId, admin.telegramGrantToken) });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    const dealer = body.dealers.find((d: any) => d.id === dealerId);
    expect(dealer).toBeTruthy();
    const sector = dealer.sectors.find((s: any) => s.id === sectorAssignedId);
    expect(sector).toBeTruthy();
    expect(sector.orgs.some((o: any) => o.id === orgA)).toBe(true);
    expect(sector.supervisors.some((s: any) => s.id === supervisorAssigned.id)).toBe(true);

    expect(body.unassigned_sectors.some((s: any) => s.id === sectorUnassignedId)).toBe(true);
    expect(body.unassigned_supervisors.some((s: any) => s.id === supervisorUnassigned.id)).toBe(true);
    // Назначенный супервайзер не должен дублироваться в хвосте непривязанных.
    expect(body.unassigned_supervisors.some((s: any) => s.id === supervisorAssigned.id)).toBe(false);
  });

  it('PATCH /admin/dealers/:id — не admin получает 403', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/dealers/${dealerId}`,
      headers: { ...authAs(manager.telegramId), 'content-type': 'application/json' },
      payload: { name: 'Hacked' }
    });
    expect(res.statusCode).toBe(403);
  });

  it('PATCH /admin/dealers/:id — admin переименовывает дилера', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/dealers/${dealerId}`,
      headers: { ...authAs(admin.telegramId, admin.telegramGrantToken), 'content-type': 'application/json' },
      payload: { name: 'Переименованный дилер' }
    });
    expect(res.statusCode).toBe(200);
    const row = await query(`SELECT name FROM dealers WHERE id = $1`, [dealerId]);
    expect(row.rows[0].name).toBe('Переименованный дилер');
  });

  it('PATCH /admin/sectors/:id — admin переименовывает сектор (sectors.name первый раз отличается от id)', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/sectors/${encodeURIComponent(sectorAssignedId)}`,
      headers: { ...authAs(admin.telegramId, admin.telegramGrantToken), 'content-type': 'application/json' },
      payload: { name: 'Северный сектор' }
    });
    expect(res.statusCode).toBe(200);
    const row = await query(`SELECT name FROM sectors WHERE id = $1`, [sectorAssignedId]);
    expect(row.rows[0].name).toBe('Северный сектор');
    expect(row.rows[0].name).not.toBe(sectorAssignedId);
  });
});
