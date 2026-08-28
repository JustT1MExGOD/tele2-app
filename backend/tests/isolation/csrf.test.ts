/**
 * 20.48.0 (Web Security & Trust Layer) — requireCsrf (auth/csrf.ts):
 * мутирующий browser-запрос с t2_session cookie требует X-CSRF-Token
 * совпадающего с t2_csrf cookie; Sec-Fetch-Site:cross-site отклоняется
 * ещё раньше. Telegram-путь (нет t2_session cookie) не затронут вообще.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { hashPassword } from '../../src/auth/password.js';
import * as sessionsRepo from '../../src/data/repositories/sessions.js';

function uniquePhone(): string {
  return '+7905' + Math.floor(1000000 + Math.random() * 8999999);
}

describe('CSRF — requireCsrf', () => {
  const fx = new TestFixtures();
  afterAll(() => fx.cleanup());

  async function makePhoneSession() {
    const org = await fx.createOrg('CSRF Org');
    const passwordHash = await hashPassword('csrf-pass');
    const { id } = await fx.createPhoneEmployee(org, uniquePhone(), passwordHash, { fullName: 'CSRF Target' });
    const token = await sessionsRepo.createSession(id);
    return token;
  }

  it('мутирующий запрос с t2_session, БЕЗ X-CSRF-Token — 403', async () => {
    const app = await getApp();
    const token = await makePhoneSession();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: `t2_session=${token}` },
      payload: {}
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('csrf_mismatch');
  });

  it('мутирующий запрос с t2_session и НЕВЕРНЫМ X-CSRF-Token — 403', async () => {
    const app = await getApp();
    const token = await makePhoneSession();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: `t2_session=${token}; t2_csrf=real-token`, 'x-csrf-token': 'wrong-token' },
      payload: {}
    });
    expect(res.statusCode).toBe(403);
  });

  it('мутирующий запрос с t2_session и СОВПАДАЮЩИМ X-CSRF-Token — проходит, оба cookie чистятся', async () => {
    const app = await getApp();
    const token = await makePhoneSession();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: `t2_session=${token}; t2_csrf=matching-token`, 'x-csrf-token': 'matching-token' },
      payload: {}
    });
    expect(res.statusCode).toBe(200);
  });

  it('Sec-Fetch-Site: cross-site — 403 ещё до проверки токена (даже с верным токеном)', async () => {
    const app = await getApp();
    const token = await makePhoneSession();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: {
        cookie: `t2_session=${token}; t2_csrf=matching-token`,
        'x-csrf-token': 'matching-token',
        'sec-fetch-site': 'cross-site'
      },
      payload: {}
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('csrf_rejected');
  });

  it('запрос БЕЗ t2_session cookie (Telegram-путь) — CSRF не применяется вообще, проходит без X-CSRF-Token', async () => {
    const app = await getApp();
    const org = await fx.createOrg('CSRF Telegram Org');
    const manager = await fx.createEmployee(org, { role: 'manager' });
    const target = await fx.createEmployee(org, { role: 'employee' });
    const res = await app.inject({
      method: 'DELETE',
      url: `/employees/${target.id}`,
      headers: authAs(manager.telegramId)
    });
    expect(res.statusCode).not.toBe(403);
  });

  it('GET-запрос с t2_session cookie — CSRF не проверяется (safe method)', async () => {
    const app = await getApp();
    const token = await makePhoneSession();
    const res = await app.inject({ method: 'GET', url: '/auth/sessions', headers: { cookie: `t2_session=${token}` } });
    expect(res.statusCode).toBe(200);
  });

  // 20.48.1 — хотфикс: сотрудник, залогиненный ДО 20.48.0, несёт валидную
  // t2_session, но никогда не получал t2_csrf (ставится только при логине)
  // — без backfill'а на GET /me «Выйти» бесконечно падает в csrf_mismatch
  // до принудительного релогина.
  it('GET /me с t2_session без t2_csrf — backfill выставляет t2_csrf, дальше logout проходит без релогина', async () => {
    const app = await getApp();
    const token = await makePhoneSession();

    const me = await app.inject({ method: 'GET', url: '/me', headers: { cookie: `t2_session=${token}` } });
    expect(me.statusCode).toBe(200);
    const csrfCookie = me.cookies.find((c: any) => c.name === 't2_csrf');
    expect(csrfCookie).toBeDefined();
    expect(csrfCookie!.value.length).toBeGreaterThan(10);

    const logout = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: `t2_session=${token}; t2_csrf=${csrfCookie!.value}`, 'x-csrf-token': csrfCookie!.value },
      payload: {}
    });
    expect(logout.statusCode).toBe(200);
  });

  it('GET /me с t2_session И уже существующим t2_csrf — не перевыставляет cookie', async () => {
    const app = await getApp();
    const token = await makePhoneSession();
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { cookie: `t2_session=${token}; t2_csrf=already-here` }
    });
    expect(res.statusCode).toBe(200);
    expect(res.cookies.find((c: any) => c.name === 't2_csrf')).toBeUndefined();
  });
});
