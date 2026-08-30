/**
 * Supervisor Scope Cache (19.25.0) — resolveSupervisorStores() кэширует
 * результат JOIN supervisor_sectors → organizations → stores для
 * role='supervisor'. Проверяем: второй вызов — hit, не повторный SQL;
 * PUT /supervisor/:id/sector инвалидирует конкретного супервайзера;
 * PUT /admin/org/:id (смена organizations.sector_id) сбрасывает весь кэш.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import { resolveSupervisorStores } from '../../src/core/analytics/supervisor.js';
import { getStats, invalidateAll } from '../../src/core/shared/scope-cache.js';

describe('Supervisor Scope Cache', () => {
  const fx = new TestFixtures();
  let orgA: string, orgB: string;
  let storeA: string, storeB: string;
  let admin: { id: number; telegramId: number };
  let supervisor: { id: number; telegramId: number };
  const sectorX = `scache_sector_x_${Date.now()}`;
  const sectorY = `scache_sector_y_${Date.now()}`;

  beforeAll(async () => {
    await query(`INSERT INTO sectors (id, name) VALUES ($1, $1), ($2, $2) ON CONFLICT DO NOTHING`, [sectorX, sectorY]);

    orgA = await fx.createOrg('Scope Cache Org A');
    orgB = await fx.createOrg('Scope Cache Org B');
    await query(`UPDATE organizations SET sector_id = $1 WHERE id = $2`, [sectorX, orgA]);
    await query(`UPDATE organizations SET sector_id = $1 WHERE id = $2`, [sectorY, orgB]);

    storeA = await fx.createStore(orgA, 'Scope Cache Store A');
    storeB = await fx.createStore(orgB, 'Scope Cache Store B');

    admin = await fx.createEmployee(orgA, { role: 'admin' });
    supervisor = await fx.createEmployee(orgA, { role: 'supervisor' });
  });

  afterAll(async () => {
    await query(`DELETE FROM supervisor_sectors WHERE supervisor_id = $1`, [supervisor.id]);
    invalidateAll();
    // fx.cleanup() удаляет organizations (ссылаются на sectors через FK)
    // ДО того, как можно безопасно удалить сами sectors.
    await fx.cleanup();
    await query(`DELETE FROM sectors WHERE id = ANY($1)`, [[sectorX, sectorY]]);
  });

  it('второй вызов resolveSupervisorStores — hit, не промах', async () => {
    invalidateAll();
    await query(`INSERT INTO supervisor_sectors (supervisor_id, sector_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [supervisor.id, sectorX]);

    const before = getStats();
    const first = await resolveSupervisorStores(supervisor.id, 'supervisor');
    expect(first).toContain(storeA);

    const afterFirst = getStats();
    expect(afterFirst.misses).toBe(before.misses + 1);

    const second = await resolveSupervisorStores(supervisor.id, 'supervisor');
    expect(second).toEqual(first);

    const afterSecond = getStats();
    expect(afterSecond.hits).toBe(afterFirst.hits + 1);
    expect(afterSecond.misses).toBe(afterFirst.misses);
  });

  it('PUT /supervisor/:id/sector инвалидирует кэш конкретного супервайзера', async () => {
    const app = await getApp();

    // прогреваем кэш на секторе X
    await resolveSupervisorStores(supervisor.id, 'supervisor');
    const warm = await resolveSupervisorStores(supervisor.id, 'supervisor');
    expect(warm).toContain(storeA);
    expect(warm).not.toContain(storeB);

    // переназначаем на сектор Y через реальный роут — не напрямую в БД,
    // чтобы проверить именно инвалидацию, которую делает сам обработчик
    const res = await app.inject({
      method: 'PUT',
      url: `/supervisor/${supervisor.id}/sector`,
      headers: { ...authAs(admin.telegramId, admin.telegramGrantToken), 'content-type': 'application/json' },
      payload: { sector_id: sectorY }
    });
    expect(res.statusCode).toBe(200);

    const afterReassign = await resolveSupervisorStores(supervisor.id, 'supervisor');
    expect(afterReassign).toContain(storeB);
    expect(afterReassign).not.toContain(storeA);
  });

  it('PUT /admin/org/:id (смена сектора сети) сбрасывает весь кэш', async () => {
    const app = await getApp();

    // супервайзер снова на секторе X (orgA) — правка supervisor_sectors
    // напрямую через SQL, в обход роута, поэтому кэш нужно сбросить руками
    // (в реальном коде эту правку всегда сопровождает вызов инвалидации).
    await query(`DELETE FROM supervisor_sectors WHERE supervisor_id = $1`, [supervisor.id]);
    await query(`INSERT INTO supervisor_sectors (supervisor_id, sector_id) VALUES ($1, $2)`, [supervisor.id, sectorX]);
    invalidateAll();
    const warm = await resolveSupervisorStores(supervisor.id, 'supervisor');
    expect(warm).toContain(storeA);

    // orgA переезжает в сектор Y
    const res = await app.inject({
      method: 'PUT',
      url: `/admin/org/${orgA}`,
      headers: { ...authAs(admin.telegramId, admin.telegramGrantToken), 'content-type': 'application/json' },
      payload: { name: 'Scope Cache Org A', sector_id: sectorY }
    });
    expect(res.statusCode).toBe(200);

    // супервайзер сектора X больше не должен видеть storeA (orgA уехала в Y)
    const afterMove = await resolveSupervisorStores(supervisor.id, 'supervisor');
    expect(afterMove).not.toContain(storeA);
  });
});
