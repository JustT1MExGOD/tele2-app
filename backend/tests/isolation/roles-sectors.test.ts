import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

// Регрессия: PATCH /employees/:id/role был вообще без проверки сети —
// manager любой сети мог поменять роль (вплоть до admin) вообще любому
// сотруднику другой сети по угаданному id. PUT /supervisor/:id/sector —
// назначение сектора (доступ ко ВСЕМ сетям сектора) было доступно обычному
// manager, а не только admin.
describe('Изоляция назначения ролей и секторов', () => {
  const fx = new TestFixtures();
  let orgA: string, orgB: string;
  let managerA: { id: number; telegramId: number };
  let managerB: { id: number; telegramId: number };
  let admin: { id: number; telegramId: number };
  let employeeA: { id: number; telegramId: number };
  const sectorId = `t17_sector_${Date.now()}`;

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A');
    orgB = await fx.createOrg('Org B');
    managerA = await fx.createEmployee(orgA, { role: 'manager' });
    managerB = await fx.createEmployee(orgB, { role: 'manager' });
    admin = await fx.createEmployee(orgA, { role: 'admin' });
    employeeA = await fx.createEmployee(orgA, { role: 'employee' });
    await query(`INSERT INTO sectors (id, name) VALUES ($1, $1)`, [sectorId]);
  });

  afterAll(async () => {
    await query('DELETE FROM supervisor_sectors WHERE sector_id = $1', [sectorId]);
    await query('DELETE FROM sectors WHERE id = $1', [sectorId]);
    await fx.cleanup();
  });

  it('PATCH /employees/:id/role — чужая сеть получает 403', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/employees/${employeeA.id}/role`,
      headers: { ...authAs(managerB.telegramId), 'content-type': 'application/json' },
      payload: { role: 'manager' }
    });
    expect(res.statusCode).toBe(403);
  });

  it('PATCH /employees/:id/role — своя сеть может назначить роль ниже своей', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/employees/${employeeA.id}/role`,
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { role: 'senior' }
    });
    expect(res.statusCode).toBe(200);
  });

  it('POST /employees/:id/role (старый дубликат) удалён — 404', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: `/employees/${employeeA.id}/role`,
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { role: 'senior' }
    });
    expect(res.statusCode).toBe(404);
  });

  it('PUT /supervisor/:id/sector — обычный manager получает 403 (не admin)', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/supervisor/${employeeA.id}/sector`,
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { sector_id: sectorId }
    });
    expect(res.statusCode).toBe(403);
  });

  it('PUT /supervisor/:id/sector — admin может назначить сектор', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/supervisor/${employeeA.id}/sector`,
      headers: { ...authAs(admin.telegramId), 'content-type': 'application/json' },
      payload: { sector_id: sectorId }
    });
    expect(res.statusCode).toBe(200);
  });

  // 21.x — реальный баг, найденный аудитом кода перед тем, как он был
  // исправлен на фронтенде (Team::setRole): повышение до supervisor
  // никогда не передавало sector_id, PATCH /employees/:id/role молча не
  // писал строку в supervisor_sectors, если sector_id отсутствовал — раньше
  // это поведение НЕ было закрыто ни одним тестом, только виднелось из
  // чтения кода. Теперь закрыто явно, в обе стороны.
  it('PATCH /employees/:id/role — role=supervisor С sector_id реально пишет строку в supervisor_sectors', async () => {
    const app = await getApp();
    const candidate = await fx.createEmployee(orgA, { role: 'employee' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/employees/${candidate.id}/role`,
      headers: { ...authAs(admin.telegramId), 'content-type': 'application/json' },
      payload: { role: 'supervisor', sector_id: sectorId }
    });
    expect(res.statusCode).toBe(200);
    const row = await query(`SELECT sector_id FROM supervisor_sectors WHERE supervisor_id = $1`, [candidate.id]);
    expect(row.rows.length).toBe(1);
    expect(row.rows[0].sector_id).toBe(sectorId);
  });

  it('PATCH /employees/:id/role — role=supervisor БЕЗ sector_id не пишет строку и не падает (текущее осознанное поведение — "пропустить, назначу позже")', async () => {
    const app = await getApp();
    const candidate = await fx.createEmployee(orgA, { role: 'employee' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/employees/${candidate.id}/role`,
      headers: { ...authAs(admin.telegramId), 'content-type': 'application/json' },
      payload: { role: 'supervisor' }
    });
    expect(res.statusCode).toBe(200);
    const row = await query(`SELECT sector_id FROM supervisor_sectors WHERE supervisor_id = $1`, [candidate.id]);
    expect(row.rows.length).toBe(0);
  });
});
