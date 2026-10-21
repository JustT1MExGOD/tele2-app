/**
 * §D плана (глобальная админка) — POST /admin/stores/:id/move: раньше
 * точку нельзя было перенести в другую сеть вообще (org_id сознательно
 * исключён из PATCH /admin/stores/:id, см. admin/stores.ts). Тесты:
 * не-admin — 403; целевая сеть не существует — 404; успешный перенос
 * между сетями разных дилеров (глобальная админка — не ограничена
 * своим дилером); точка не в исходной сети — 404 (защита от гонки).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

describe('POST /admin/stores/:id/move', () => {
  const fx = new TestFixtures();

  afterAll(async () => {
    await fx.cleanup();
  });

  it('не-admin — 403', async () => {
    const app = await getApp();
    const orgA = await fx.createOrg('Move Store Org A');
    const orgB = await fx.createOrg('Move Store Org B');
    const storeId = await fx.createStore(orgA, 'Точка на перенос');
    const manager = await fx.createEmployee(orgA, { role: 'manager' });

    const res = await app.inject({
      method: 'POST',
      url: `/admin/stores/${storeId}/move`,
      headers: { ...authAs(manager.telegramId), 'content-type': 'application/json' },
      payload: { toOrgId: orgB }
    });
    expect(res.statusCode).toBe(403);
  });

  it('целевая сеть не существует — 404', async () => {
    const app = await getApp();
    const orgA = await fx.createOrg('Move Store Missing Target Org');
    const storeId = await fx.createStore(orgA, 'Точка');
    const admin = await fx.createEmployee(orgA, { role: 'admin' });

    const res = await app.inject({
      method: 'POST',
      url: `/admin/stores/${storeId}/move`,
      headers: { ...authAs(admin.telegramId, admin.telegramGrantToken), 'content-type': 'application/json' },
      payload: { toOrgId: 'org_does_not_exist_xyz' }
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('target_org_not_found');
  });

  it('глобальная админка: админ сети A переносит точку в сеть B (разные дилеры/без общего дилера)', async () => {
    const app = await getApp();
    const orgA = await fx.createOrg('Move Store Global Org A');
    const orgB = await fx.createOrg('Move Store Global Org B');
    const storeId = await fx.createStore(orgA, 'Переносимая точка');
    const admin = await fx.createEmployee(orgA, { role: 'admin' });

    const res = await app.inject({
      method: 'POST',
      url: `/admin/stores/${storeId}/move`,
      headers: { ...authAs(admin.telegramId, admin.telegramGrantToken), 'content-type': 'application/json' },
      payload: { toOrgId: orgB }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().store.org_id).toBe(orgB);

    const row = await query(`SELECT org_id FROM stores WHERE id = $1`, [storeId]);
    expect(row.rows[0].org_id).toBe(orgB);

    // Повторный перенос с тем же fromOrgId (orgA) — точка там уже не
    // находится, 404 (защита от гонки, не auth-граница).
    const stale = await app.inject({
      method: 'POST',
      url: `/admin/stores/${storeId}/move`,
      headers: { ...authAs(admin.telegramId, admin.telegramGrantToken), 'content-type': 'application/json' },
      payload: { toOrgId: orgA }
    });
    expect(stale.statusCode).toBe(404);
  });
});
