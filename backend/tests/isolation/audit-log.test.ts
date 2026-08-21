/**
 * Audit Trail (19.23.0) — org-scoping на GET /audit, факт записи события
 * реальным действием (role_change), и отдельно withTransaction(): падение
 * колбэка обязано откатить ВСЕ его запросы, не только часть.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query, withTransaction } from '../../src/db/index.js';

describe('Audit Trail', () => {
  const fx = new TestFixtures();
  let orgA: string, orgB: string;
  let adminA: { id: number; telegramId: number };
  let adminB: { id: number; telegramId: number };
  let employeeA: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Audit Org A');
    orgB = await fx.createOrg('Audit Org B');
    adminA = await fx.createEmployee(orgA, { role: 'admin' });
    adminB = await fx.createEmployee(orgB, { role: 'admin' });
    employeeA = await fx.createEmployee(orgA, { role: 'employee' });
  });

  afterAll(async () => {
    await query(`DELETE FROM audit_log WHERE org_id = ANY($1)`, [[orgA, orgB]]);
    await fx.cleanup();
  });

  it('роль сотрудника меняется PATCH /employees/:id/role и оставляет строку в audit_log', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/employees/${employeeA.id}/role`,
      headers: { ...authAs(adminA.telegramId), 'content-type': 'application/json' },
      payload: { role: 'senior' }
    });
    expect(res.statusCode).toBe(200);

    const row = await query(
      `SELECT * FROM audit_log WHERE action = 'employee.role_change' AND target_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [String(employeeA.id)]
    );
    expect(row.rows[0]).toBeTruthy();
    expect(row.rows[0].org_id).toBe(orgA);
    expect(row.rows[0].before.role).toBe('employee');
    expect(row.rows[0].after.role).toBe('senior');
    expect(row.rows[0].request_id).toBeTruthy();
  });

  it('GET /audit — чужая сеть не видит события другой сети', async () => {
    const app = await getApp();
    const resA = await app.inject({ method: 'GET', url: '/audit', headers: authAs(adminA.telegramId) });
    expect(resA.statusCode).toBe(200);
    const itemsA = resA.json().items;
    expect(itemsA.some((i: any) => i.org_id === orgB)).toBe(false);

    const resB = await app.inject({ method: 'GET', url: '/audit', headers: authAs(adminB.telegramId) });
    expect(resB.statusCode).toBe(200);
    const itemsB = resB.json().items;
    expect(itemsB.some((i: any) => i.org_id === orgA)).toBe(false);
  });

  it('GET /audit — не admin получает 403', async () => {
    const app = await getApp();
    const managerRes = await fx.createEmployee(orgA, { role: 'manager' });
    const res = await app.inject({ method: 'GET', url: '/audit', headers: authAs(managerRes.telegramId) });
    expect(res.statusCode).toBe(403);
  });

  it('withTransaction — падение колбэка откатывает ВСЕ его запросы', async () => {
    const scratchId = `wtx_test_${Date.now()}`;
    await expect(
      withTransaction(async (q) => {
        await q(
          `INSERT INTO audit_log (org_id, action, target_type, target_id) VALUES ($1, 'test.rollback', 'test', $2)`,
          [orgA, scratchId]
        );
        await q(
          `INSERT INTO audit_log (org_id, action, target_type, target_id) VALUES ($1, 'test.rollback', 'test', $2)`,
          [orgA, scratchId + '_second']
        );
        throw new Error('forced failure mid-transaction');
      })
    ).rejects.toThrow('forced failure mid-transaction');

    const rows = await query(`SELECT * FROM audit_log WHERE action = 'test.rollback' AND target_id LIKE $1`, [`${scratchId}%`]);
    expect(rows.rows.length).toBe(0);
  });

  it('withTransaction — успешный колбэк коммитит все запросы', async () => {
    const scratchId = `wtx_ok_${Date.now()}`;
    await withTransaction(async (q) => {
      await q(
        `INSERT INTO audit_log (org_id, action, target_type, target_id) VALUES ($1, 'test.commit', 'test', $2)`,
        [orgA, scratchId]
      );
      await q(
        `INSERT INTO audit_log (org_id, action, target_type, target_id) VALUES ($1, 'test.commit', 'test', $2)`,
        [orgA, scratchId + '_second']
      );
    });

    const rows = await query(`SELECT * FROM audit_log WHERE action = 'test.commit' AND target_id LIKE $1`, [`${scratchId}%`]);
    expect(rows.rows.length).toBe(2);
    await query(`DELETE FROM audit_log WHERE action = 'test.commit' AND target_id LIKE $1`, [`${scratchId}%`]);
  });
});
