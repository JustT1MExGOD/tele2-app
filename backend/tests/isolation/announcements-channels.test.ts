import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

// Регрессия на 15.16.0: announcements.org_id/channels.org_id существовали в
// схеме, но ни один запрос их не читал — сотрудник любой сети видел
// объявления и мог читать/писать в каналы вообще всех сетей.
describe('Изоляция объявлений и каналов (/announcements, /channels)', () => {
  const fx = new TestFixtures();
  let orgA: string, orgB: string;
  let managerA: { id: number; telegramId: number };
  let managerB: { id: number; telegramId: number };
  let announcementId: number;
  const channelId = `test17_ch_${Date.now()}`;

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A');
    orgB = await fx.createOrg('Org B');
    managerA = await fx.createEmployee(orgA, { role: 'manager' });
    managerB = await fx.createEmployee(orgB, { role: 'manager' });
    await query(
      `INSERT INTO channels (id, org_id, kind, title) VALUES ($1, $2, 'sales', 'Test channel')`,
      [channelId, orgA]
    );
  });

  afterAll(async () => {
    await query('DELETE FROM channel_messages WHERE channel_id = $1', [channelId]);
    await query('DELETE FROM channels WHERE id = $1', [channelId]);
    if (announcementId) {
      await query('DELETE FROM announcement_reads WHERE announcement_id = $1', [announcementId]);
      await query('DELETE FROM announcements WHERE id = $1', [announcementId]);
    }
    await fx.cleanup();
  });

  it('POST /announcements создаёт объявление в сети создающего', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/announcements',
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { title: 'Test', body: 'Isolation test', required: true }
    });
    expect(res.statusCode).toBe(200);
    announcementId = Number(res.json().id);
  });

  it('GET /announcements — чужая сеть не видит объявление', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/announcements', headers: authAs(managerB.telegramId) });
    const rows = res.json();
    expect(rows.find((r: any) => Number(r.id) === announcementId)).toBeUndefined();
  });

  it('GET /announcements — своя сеть видит объявление', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/announcements', headers: authAs(managerA.telegramId) });
    const rows = res.json();
    expect(rows.find((r: any) => Number(r.id) === announcementId)).toBeDefined();
  });

  it('GET /announcements/:id/reads — чужая сеть получает 403', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/announcements/${announcementId}/reads`,
      headers: authAs(managerB.telegramId)
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET /channels/:id/messages — чужая сеть получает 403', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/channels/${channelId}/messages`,
      headers: authAs(managerB.telegramId)
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST /channels/:id/messages — чужая сеть получает 403', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: `/channels/${channelId}/messages`,
      headers: { ...authAs(managerB.telegramId), 'content-type': 'application/json' },
      payload: { body: 'sneaky message' }
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST /channels/:id/messages — своя сеть может писать', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: `/channels/${channelId}/messages`,
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { body: 'legit message' }
    });
    expect(res.statusCode).toBe(200);
  });
});
