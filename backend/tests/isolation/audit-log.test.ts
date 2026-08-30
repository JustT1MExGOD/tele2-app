/**
 * Audit Trail (19.23.0) — org-scoping на GET /audit, факт записи события
 * реальным действием (role_change), и отдельно withTransaction(): падение
 * колбэка обязано откатить ВСЕ его запросы, не только часть.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query, withTransaction } from '../../src/data/db/index.js';

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
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
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
    // 20.10.0 — снимок роли АКТОРА (admin, кто сделал смену), не цели;
    // target_org_id по умолчанию равен org_id (нет кросс-org действий сегодня).
    expect(row.rows[0].actor_role).toBe('admin');
    expect(row.rows[0].target_org_id).toBe(orgA);
  });

  it('GET /audit — чужая сеть не видит события другой сети', async () => {
    const app = await getApp();
    const resA = await app.inject({ method: 'GET', url: '/audit', headers: authAs(adminA.telegramId, adminA.telegramGrantToken) });
    expect(resA.statusCode).toBe(200);
    const itemsA = resA.json().items;
    expect(itemsA.some((i: any) => i.org_id === orgB)).toBe(false);

    const resB = await app.inject({ method: 'GET', url: '/audit', headers: authAs(adminB.telegramId, adminB.telegramGrantToken) });
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

  // 21.x — GET /audit уже полностью поддерживал action/target_type/from/to/
  // limit/offset на бэкенде, но ни один тест их не проверял (фронтенд их
  // тоже никогда не вызывал — см. changelog версии, где это найдено).
  it('GET /audit — фильтр по action сужает выборку', async () => {
    const marker = `filtertest_${Date.now()}`;
    await query(
      `INSERT INTO audit_log (org_id, action, target_type, target_id) VALUES ($1, 'sales.correction', 'sale', $2)`,
      [orgA, marker]
    );
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: `/audit?action=sales.correction`, headers: authAs(adminA.telegramId, adminA.telegramGrantToken) });
    expect(res.statusCode).toBe(200);
    const items = res.json().items;
    expect(items.every((i: any) => i.action === 'sales.correction')).toBe(true);
    expect(items.some((i: any) => i.target_id === marker)).toBe(true);
    await query(`DELETE FROM audit_log WHERE target_id = $1`, [marker]);
  });

  it('GET /audit — фильтр по target_type сужает выборку', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: `/audit?target_type=employee`, headers: authAs(adminA.telegramId, adminA.telegramGrantToken) });
    expect(res.statusCode).toBe(200);
    const items = res.json().items;
    expect(items.every((i: any) => i.target_type === 'employee')).toBe(true);
  });

  it('GET /audit — фильтр по from/to (диапазон дат) исключает события вне окна', async () => {
    const marker = `datetest_${Date.now()}`;
    await query(
      `INSERT INTO audit_log (org_id, action, target_type, target_id, created_at) VALUES ($1, 'test.old', 'test', $2, now() - interval '30 days')`,
      [orgA, marker]
    );
    const app = await getApp();
    const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const res = await app.inject({ method: 'GET', url: `/audit?from=${encodeURIComponent(from)}`, headers: authAs(adminA.telegramId, adminA.telegramGrantToken) });
    expect(res.statusCode).toBe(200);
    const items = res.json().items;
    expect(items.some((i: any) => i.target_id === marker)).toBe(false);
    await query(`DELETE FROM audit_log WHERE target_id = $1`, [marker]);
  });

  it('GET /audit — limit/offset пагинируют', async () => {
    const app = await getApp();
    const page1 = await app.inject({ method: 'GET', url: `/audit?limit=1&offset=0`, headers: authAs(adminA.telegramId, adminA.telegramGrantToken) });
    expect(page1.json().items.length).toBeLessThanOrEqual(1);
  });

  // A3 — раньше resolveViewOrgId(request.user!, undefined) игнорировал
  // ?org_id= совсем, admin не мог посмотреть аудит другой сети через
  // тот же org-переключатель, что уже работает у остальных admin-роутов.
  it('GET /audit — admin с ?org_id= видит выбранную сеть, не только свою', async () => {
    const marker = `orgoverride_${Date.now()}`;
    await query(
      `INSERT INTO audit_log (org_id, action, target_type, target_id) VALUES ($1, 'test.orgoverride', 'test', $2)`,
      [orgB, marker]
    );
    const app = await getApp();
    // Без override — adminA сидит в orgA, чужого маркера не видит.
    const withoutOverride = await app.inject({ method: 'GET', url: '/audit', headers: authAs(adminA.telegramId, adminA.telegramGrantToken) });
    expect(withoutOverride.json().items.some((i: any) => i.target_id === marker)).toBe(false);

    const res = await app.inject({ method: 'GET', url: `/audit?org_id=${orgB}`, headers: authAs(adminA.telegramId, adminA.telegramGrantToken) });
    expect(res.statusCode).toBe(200);
    const items = res.json().items;
    expect(items.every((i: any) => i.org_id === orgB)).toBe(true);
    expect(items.some((i: any) => i.target_id === marker)).toBe(true);
    await query(`DELETE FROM audit_log WHERE target_id = $1`, [marker]);
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
