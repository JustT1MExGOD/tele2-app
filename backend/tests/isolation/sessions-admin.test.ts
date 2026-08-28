/**
 * 20.48.0 (Web Security & Trust Layer) — GET/DELETE /auth/sessions,
 * POST /auth/sessions/revoke-others: ownership-scoping, работает для
 * любого provider'а (Telegram видит свои phone-сессии тоже).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAs, authAsSession } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { hashPassword } from '../../src/auth/password.js';
import * as sessionsRepo from '../../src/data/repositories/sessions.js';

function uniquePhone(): string {
  return '+7904' + Math.floor(1000000 + Math.random() * 8999999);
}

describe('GET/DELETE /auth/sessions, POST /auth/sessions/revoke-others', () => {
  const fx = new TestFixtures();
  afterAll(() => fx.cleanup());

  it('список отдаёт только свои сессии, current=true у той, чьей cookie пришёл запрос', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Sessions List Org');
    const passwordHash = await hashPassword('list-pass');
    const { id: employeeId } = await fx.createPhoneEmployee(org, uniquePhone(), passwordHash, { fullName: 'Sessions List Target' });
    const tokenA = await sessionsRepo.createSession(employeeId);
    const tokenB = await sessionsRepo.createSession(employeeId);

    const res = await app.inject({ method: 'GET', url: '/auth/sessions', headers: authAsSession(tokenA) });
    expect(res.statusCode).toBe(200);
    const sessions = res.json().sessions;
    expect(sessions.length).toBe(2);
    expect(sessions.filter((s: any) => s.current).length).toBe(1);
    void tokenB;
  });

  it('Telegram-пользователь видит свои phone-сессии с current:false на всех (нет t2_session cookie в его запросе)', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Sessions Telegram Org');
    const employee = await fx.createEmployee(org, { role: 'employee' });
    await sessionsRepo.createSession(employee.id);

    const res = await app.inject({ method: 'GET', url: '/auth/sessions', headers: authAs(employee.telegramId) });
    expect(res.statusCode).toBe(200);
    const sessions = res.json().sessions;
    expect(sessions.length).toBe(1);
    expect(sessions[0].current).toBe(false);
  });

  it('DELETE /auth/sessions/:id — нельзя отозвать чужую сессию по id', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Sessions Ownership Org');
    const passwordHash = await hashPassword('own-pass');
    const victim = await fx.createPhoneEmployee(org, uniquePhone(), passwordHash, { fullName: 'Victim' });
    const attacker = await fx.createPhoneEmployee(org, uniquePhone(), passwordHash, { fullName: 'Attacker' });
    const victimToken = await sessionsRepo.createSession(victim.id);
    const attackerToken = await sessionsRepo.createSession(attacker.id);

    const victimSessions = await app.inject({ method: 'GET', url: '/auth/sessions', headers: authAsSession(victimToken) });
    const victimSessionId = victimSessions.json().sessions[0].id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/auth/sessions/${victimSessionId}`,
      headers: authAsSession(attackerToken)
    });
    expect(res.statusCode).toBe(404);

    const stillThere = await app.inject({ method: 'GET', url: '/access/requests', headers: authAsSession(victimToken) });
    expect(stillThere.statusCode).not.toBe(401);
  });

  it('DELETE своей ТЕКУЩЕЙ сессии — 204/200 и чистит оба cookie (t2_session, t2_csrf)', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Sessions Self Delete Org');
    const passwordHash = await hashPassword('self-del-pass');
    const { id: employeeId } = await fx.createPhoneEmployee(org, uniquePhone(), passwordHash, { fullName: 'Self Delete Target' });
    const token = await sessionsRepo.createSession(employeeId);

    const list = await app.inject({ method: 'GET', url: '/auth/sessions', headers: authAsSession(token) });
    const sessionId = list.json().sessions[0].id;

    const res = await app.inject({ method: 'DELETE', url: `/auth/sessions/${sessionId}`, headers: authAsSession(token) });
    expect(res.statusCode).toBe(200);
    const clearedNames = res.cookies.map((c: any) => c.name);
    expect(clearedNames).toContain('t2_session');
    expect(clearedNames).toContain('t2_csrf');

    const after = await app.inject({ method: 'GET', url: '/access/requests', headers: authAsSession(token) });
    expect(after.statusCode).toBe(401);
  });

  it('POST /auth/sessions/revoke-others — завершает остальные, не трогает текущую', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Sessions Revoke Others Org');
    const passwordHash = await hashPassword('revoke-others-pass');
    const { id: employeeId } = await fx.createPhoneEmployee(org, uniquePhone(), passwordHash, { fullName: 'Revoke Others Target' });
    const current = await sessionsRepo.createSession(employeeId);
    const other1 = await sessionsRepo.createSession(employeeId);
    const other2 = await sessionsRepo.createSession(employeeId);

    const res = await app.inject({ method: 'POST', url: '/auth/sessions/revoke-others', headers: authAsSession(current) });
    expect(res.statusCode).toBe(200);

    const stillCurrent = await app.inject({ method: 'GET', url: '/access/requests', headers: authAsSession(current) });
    expect(stillCurrent.statusCode).not.toBe(401);

    const gone1 = await app.inject({ method: 'GET', url: '/access/requests', headers: authAsSession(other1) });
    expect(gone1.statusCode).toBe(401);
    const gone2 = await app.inject({ method: 'GET', url: '/access/requests', headers: authAsSession(other2) });
    expect(gone2.statusCode).toBe(401);
  });
});
