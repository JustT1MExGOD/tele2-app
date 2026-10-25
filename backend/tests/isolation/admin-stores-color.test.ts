/**
 * PATCH /admin/stores/:id — цвет точки в графике (stores.color). Цвет
 * подставляется без esc() в inline style="..." на фронтенде (storeColor()),
 * поэтому формат фиксируется на входе: строго #rrggbb. Тесты: не-admin — 403;
 * валидный цвет сохраняется и попадает в аудит; всё остальное (имена цветов,
 * короткий hex, style-breakout) — 400 и в БД не пишется.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

describe('PATCH /admin/stores/:id — color', () => {
  const fx = new TestFixtures();

  afterAll(async () => {
    await fx.cleanup();
  });

  it('не-admin — 403, цвет не меняется', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Store Color Org Forbidden');
    const storeId = await fx.createStore(org, 'Точка цвета 1');
    const manager = await fx.createEmployee(org, { role: 'manager' });

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/stores/${storeId}`,
      headers: { ...authAs(manager.telegramId), 'content-type': 'application/json' },
      payload: { color: '#ff6d01' }
    });
    expect(res.statusCode).toBe(403);
    const row = await query(`SELECT color FROM stores WHERE id = $1`, [storeId]);
    expect(row.rows[0].color).not.toBe('#ff6d01');
  });

  it('admin: валидный цвет сохраняется и пишется в audit_log', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Store Color Org Ok');
    const storeId = await fx.createStore(org, 'Точка цвета 2');
    const admin = await fx.createEmployee(org, { role: 'admin' });

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/stores/${storeId}`,
      headers: { ...authAs(admin.telegramId, admin.telegramGrantToken), 'content-type': 'application/json' },
      payload: { color: '#FF6D01' }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().store.color).toBe('#FF6D01');

    const row = await query(`SELECT color FROM stores WHERE id = $1`, [storeId]);
    expect(row.rows[0].color).toBe('#FF6D01');

    const audit = await query(
      `SELECT after FROM audit_log WHERE action = 'admin.store_edit' AND target_id = $1 ORDER BY id DESC LIMIT 1`,
      [storeId]
    );
    expect(audit.rows[0].after.color).toBe('#FF6D01');
  });

  it.each([
    ['имя цвета', 'red'],
    ['короткий hex', '#fff'],
    ['не hex-символы', '#12345g'],
    ['rgb()', 'rgb(0,0,0)'],
    ['style-breakout', '#000000;background:url(//evil.example/x)'],
    ['html-breakout', '"><img src=x onerror=alert(1)>'],
    ['пустая строка', '']
  ])('admin: %s — 400, в БД не пишется', async (_label, bad) => {
    const app = await getApp();
    const org = await fx.createOrg('Store Color Org Bad');
    const storeId = await fx.createStore(org, 'Точка цвета 3');
    const admin = await fx.createEmployee(org, { role: 'admin' });
    const before = await query(`SELECT color FROM stores WHERE id = $1`, [storeId]);

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/stores/${storeId}`,
      headers: { ...authAs(admin.telegramId, admin.telegramGrantToken), 'content-type': 'application/json' },
      payload: { color: bad }
    });
    expect(res.statusCode).toBe(400);

    const after = await query(`SELECT color FROM stores WHERE id = $1`, [storeId]);
    expect(after.rows[0].color).toBe(before.rows[0].color);
  });
});
