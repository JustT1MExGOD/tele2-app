/**
 * Дилер (21.0) — компания-владелец сектора, только ownership-запись (без
 * своего входа/роли). Заводится тем же лёгким приёмом, что сектор сейчас —
 * печатаешь имя в форме редактирования сети (PUT /admin/org/:id), дилер
 * привязывается к СЕКТОРУ этой сети, не к самой сети.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

describe('Дилер — владение сектором', () => {
  const fx = new TestFixtures();
  let orgA: string, orgB: string;
  let admin: { id: number; telegramId: number };
  const sectorX = `dealer_sector_x_${Date.now()}`;
  const sectorY = `dealer_sector_y_${Date.now()}`;
  const dealerNameX = `ООО Ромашка ${Date.now()}`;

  beforeAll(async () => {
    await query(`INSERT INTO sectors (id, name) VALUES ($1, $1), ($2, $2) ON CONFLICT DO NOTHING`, [sectorX, sectorY]);
    orgA = await fx.createOrg('Dealer Org A');
    orgB = await fx.createOrg('Dealer Org B');
    await query(`UPDATE organizations SET sector_id = $1 WHERE id = $2`, [sectorX, orgA]);
    await query(`UPDATE organizations SET sector_id = $1 WHERE id = $2`, [sectorX, orgB]); // тот же сектор X
    admin = await fx.createEmployee(orgA, { role: 'admin' });
  });

  afterAll(async () => {
    await fx.cleanup();
    // sectors.dealer_id ссылается на dealers — сектора удаляются первыми.
    await query(`DELETE FROM sectors WHERE id = ANY($1)`, [[sectorX, sectorY]]);
    await query(`DELETE FROM dealers WHERE name = $1`, [dealerNameX]);
  });

  it('PUT /admin/org/:id с dealer_name заводит дилера и привязывает к сектору сети', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/admin/org/${orgA}`,
      headers: { ...authAs(admin.telegramId), 'content-type': 'application/json' },
      payload: { name: 'Dealer Org A', sector_id: sectorX, dealer_name: dealerNameX }
    });
    expect(res.statusCode).toBe(200);

    const sector = await query(`SELECT dealer_id FROM sectors WHERE id = $1`, [sectorX]);
    expect(sector.rows[0].dealer_id).not.toBeNull();

    const dealer = await query(`SELECT name FROM dealers WHERE id = $1`, [sector.rows[0].dealer_id]);
    expect(dealer.rows[0].name).toBe(dealerNameX);
  });

  it('GET /orgs — обе сети сектора X показывают ОДНОГО и того же дилера (владение на уровне сектора, не сети)', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/orgs', headers: authAs(admin.telegramId) });
    expect(res.statusCode).toBe(200);
    const orgs = res.json();
    const a = orgs.find((o: any) => o.id === orgA);
    const b = orgs.find((o: any) => o.id === orgB);
    expect(a.dealer_name).toBe(dealerNameX);
    expect(b.dealer_name).toBe(dealerNameX); // orgB тоже в секторе X, дилер общий
  });

  it('повторный ввод ТОГО ЖЕ имени дилера не плодит дубликат (UNIQUE на name)', async () => {
    const before = await query(`SELECT count(*)::int as c FROM dealers WHERE name = $1`, [dealerNameX]);
    expect(before.rows[0].c).toBe(1);

    const app = await getApp();
    await app.inject({
      method: 'PUT',
      url: `/admin/org/${orgB}`,
      headers: { ...authAs(admin.telegramId), 'content-type': 'application/json' },
      payload: { name: 'Dealer Org B', sector_id: sectorX, dealer_name: dealerNameX }
    });

    const after = await query(`SELECT count(*)::int as c FROM dealers WHERE name = $1`, [dealerNameX]);
    expect(after.rows[0].c).toBe(1); // не 2
  });

  it('один дилер может владеть НЕСКОЛЬКИМИ секторами разом', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/admin/org/${orgA}`,
      headers: { ...authAs(admin.telegramId), 'content-type': 'application/json' },
      payload: { name: 'Dealer Org A', sector_id: sectorY, dealer_name: dealerNameX }
    });
    expect(res.statusCode).toBe(200);

    const sectors = await query(
      `SELECT s.id, d.name FROM sectors s JOIN dealers d ON d.id = s.dealer_id WHERE s.id = ANY($1) ORDER BY s.id`,
      [[sectorX, sectorY]]
    );
    expect(sectors.rows.length).toBe(2);
    expect(sectors.rows.every((r: any) => r.name === dealerNameX)).toBe(true);
  });

  it('пустой dealer_name — сектор не трогается (тот же приём, что у остальных опциональных полей формы)', async () => {
    const before = await query(`SELECT dealer_id FROM sectors WHERE id = $1`, [sectorX]);

    const app = await getApp();
    await app.inject({
      method: 'PUT',
      url: `/admin/org/${orgA}`,
      headers: { ...authAs(admin.telegramId), 'content-type': 'application/json' },
      payload: { name: 'Dealer Org A', sector_id: sectorX }
    });

    const after = await query(`SELECT dealer_id FROM sectors WHERE id = $1`, [sectorX]);
    expect(after.rows[0].dealer_id).toBe(before.rows[0].dealer_id);
  });
});
