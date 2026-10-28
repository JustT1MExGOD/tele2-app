/**
 * Adversarial regression — класс «reuse отозванной сессии» (SECURITY.md,
 * security-roadmap: механизм существует — удалённая строка не резолвится
 * resolveSession() — но до этого теста не было ИМЕННОГО regression-gate,
 * который ломался бы, если revoke/logout перестанут инвалидировать токен
 * немедленно).
 *
 * Угроза: устройство/токен украдены → жертва отзывает сессию через
 * self-service (DELETE /auth/sessions/:id, revoke-others, logout) →
 * атакующий тут же повторяет запрос с тем же t2_session. Любой ответ,
 * отличный от 401, — инцидент: сессия должна умирать синхронно с
 * DELETE-строки в employee_sessions, без TTL/кэш-окна.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAsSession } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { hashPassword } from '../../src/auth/password.js';
import * as sessionsRepo from '../../src/data/repositories/sessions.js';
import { query } from '../../src/data/db/index.js';

function uniquePhone(): string {
  return '+7903' + Math.floor(1000000 + Math.random() * 8999999);
}

describe('adversarial: reuse отозванной browser-сессии отклоняется немедленно', () => {
  const fx = new TestFixtures();
  afterAll(() => fx.cleanup());

  it('DELETE /auth/sessions/:id — следующий запрос с тем же токеном → 401', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Revoke Own Org');
    const passwordHash = await hashPassword('revoke-pass');
    const { id } = await fx.createPhoneEmployee(org, uniquePhone(), passwordHash, { fullName: 'Revoke Target' });

    // "Устройство A" — текущая вкладка, через неё отзываем "устройство B".
    const tokenA = await sessionsRepo.createSession(id);
    const tokenB = await sessionsRepo.createSession(id);

    const sessionsList = await app.inject({ method: 'GET', url: '/auth/sessions', headers: authAsSession(tokenA) });
    expect(sessionsList.statusCode).toBe(200);
    const rows: { id: number; current: boolean }[] = sessionsList.json().sessions;
    const sessionB = rows.find((r) => !r.current);
    expect(sessionB).toBeTruthy();

    const before = await app.inject({ method: 'GET', url: '/access/requests', headers: authAsSession(tokenB) });
    expect(before.statusCode).toBe(403); // сессия валидна, но employee не manager

    const revoke = await app.inject({ method: 'DELETE', url: `/auth/sessions/${sessionB!.id}`, headers: authAsSession(tokenA) });
    expect(revoke.statusCode).toBe(200);

    // Украденный токен B мёртв сразу — не «после истечения какого-то окна».
    const reuse = await app.inject({ method: 'GET', url: '/access/requests', headers: authAsSession(tokenB) });
    expect(reuse.statusCode).toBe(401);

    // Отзывающая сторона (A) при этом жива — отзыв чужой-но-своей сессии
    // не должен убивать инициатора.
    const stillAlive = await app.inject({ method: 'GET', url: '/access/requests', headers: authAsSession(tokenA) });
    expect(stillAlive.statusCode).toBe(403);
  });

  it('DELETE /auth/sessions/:id на СВОЕЙ текущей сессии — самоотзыв работает, дальше 401', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Self Revoke Org');
    const passwordHash = await hashPassword('self-revoke-pass');
    const { id } = await fx.createPhoneEmployee(org, uniquePhone(), passwordHash, { fullName: 'Self Revoke Target' });

    const token = await sessionsRepo.createSession(id);
    const list = await app.inject({ method: 'GET', url: '/auth/sessions', headers: authAsSession(token) });
    const current = (list.json().sessions as { id: number; current: boolean }[]).find((r) => r.current);
    expect(current).toBeTruthy();

    const revoke = await app.inject({ method: 'DELETE', url: `/auth/sessions/${current!.id}`, headers: authAsSession(token) });
    expect(revoke.statusCode).toBe(200);

    const reuse = await app.inject({ method: 'GET', url: '/access/requests', headers: authAsSession(token) });
    expect(reuse.statusCode).toBe(401);
  });

  it('POST /auth/logout — тот же токен на следующем запросе → 401, повторный logout безопасен', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Logout Reuse Org');
    const passwordHash = await hashPassword('logout-pass');
    const { id } = await fx.createPhoneEmployee(org, uniquePhone(), passwordHash, { fullName: 'Logout Target' });

    const token = await sessionsRepo.createSession(id);
    const before = await app.inject({ method: 'GET', url: '/me', headers: authAsSession(token) });
    expect(before.statusCode).toBe(200);

    const logout = await app.inject({ method: 'POST', url: '/auth/logout', headers: authAsSession(token) });
    expect(logout.statusCode).toBe(200);

    const reuse = await app.inject({ method: 'GET', url: '/access/requests', headers: authAsSession(token) });
    expect(reuse.statusCode).toBe(401);

    // Logout идемпотентен по дизайну (PUBLIC_ROUTES это явно разрешает):
    // повторный вызов с мёртвым токеном — не ошибка и не утечка.
    const logoutAgain = await app.inject({ method: 'POST', url: '/auth/logout', headers: authAsSession(token) });
    expect(logoutAgain.statusCode).toBe(200);
  });

  it('POST /auth/sessions/revoke-others — отозванные токены умирают, текущий живёт', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Revoke Others Org');
    const passwordHash = await hashPassword('others-pass');
    const { id } = await fx.createPhoneEmployee(org, uniquePhone(), passwordHash, { fullName: 'Revoke Others Target' });

    const tokenKeep = await sessionsRepo.createSession(id);
    const tokenX = await sessionsRepo.createSession(id);
    const tokenY = await sessionsRepo.createSession(id);

    const res = await app.inject({ method: 'POST', url: '/auth/sessions/revoke-others', headers: authAsSession(tokenKeep) });
    expect(res.statusCode).toBe(200);

    for (const stolen of [tokenX, tokenY]) {
      const reuse = await app.inject({ method: 'GET', url: '/access/requests', headers: authAsSession(stolen) });
      expect(reuse.statusCode).toBe(401);
    }
    const alive = await app.inject({ method: 'GET', url: '/me', headers: authAsSession(tokenKeep) });
    expect(alive.statusCode).toBe(200);
  });

  it('отозванная сессия не «оживает» от повторного запроса — нет write-path, пересоздающего строку', async () => {
    const app = await getApp();
    const org = await fx.createOrg('No Resurrect Org');
    const passwordHash = await hashPassword('resurrect-pass');
    const { id } = await fx.createPhoneEmployee(org, uniquePhone(), passwordHash, { fullName: 'Resurrect Target' });

    const token = await sessionsRepo.createSession(id);
    await sessionsRepo.deleteSession(token);

    // Несколько разных запросов подряд тем же мёртвым токеном — ни один не
    // должен иметь побочного эффекта «сессия снова валидна» (например,
    // touchSession с INSERT-семантикой стал бы такой регрессией).
    for (let i = 0; i < 3; i++) {
      const reuse = await app.inject({ method: 'GET', url: '/access/requests', headers: authAsSession(token) });
      expect(reuse.statusCode).toBe(401);
    }
    const rows = await query(`SELECT id FROM employee_sessions WHERE token_hash = $1`, [sessionsRepo.hashToken(token)]);
    expect(rows.rows.length).toBe(0);
  });
});
