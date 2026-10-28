/**
 * 20.49.0 (Web Security & Trust Layer, часть 2) — регресс-тест на уже
 * корректное поведение (helmet-дефолты) плюс новый Cache-Control:no-store
 * хук (app.ts). Без этого теста будущая правка app.ts могла бы молча
 * выключить nosniff/no-referrer или сломать хук — раньше не было
 * проверено вообще, только "правильно по построению".
 */
import { describe, it, expect } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import * as employeesRepo from '../../src/data/repositories/employees.js';

describe('Security headers — X-Content-Type-Options / Referrer-Policy / Cache-Control', () => {
  it('X-Content-Type-Options: nosniff и Referrer-Policy: no-referrer присутствуют на любом ответе', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('Cache-Control: no-store на типичном API-ответе без своего явного заголовка', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('Permissions-Policy (20.52.0): geolocation=(self), остальные API явно закрыты', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    const policy = res.headers['permissions-policy'] as string;
    expect(policy).toContain('geolocation=(self)');
    expect(policy).toContain('camera=()');
    expect(policy).toContain('microphone=()');
    expect(policy).toContain('payment=()');
  });

  // 20.83.0 — index.html's 119 inline handlers moved to data-on/data-arg
  // delegation (frontend/src/app/nav.ts) and the sole runtime-injected
  // <style> (shift confetti keyframe) moved into static styles.css. Locks
  // the block-level style-src tightening so a future edit can't silently
  // re-widening it, and confirms the Telegram iframe ancestors stayed put.
  it('CSP: block-level style-src has no unsafe-inline; attribute-level stays permissive; frame-ancestors keep Telegram', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toBeTruthy();
    // block-level style-src must NOT carry unsafe-inline (was the only
    // consumer: the runtime-injected confetti keyframe, now static CSS).
    const styleSrc = /style-src ([^;]+)/.exec(csp)![1];
    expect(styleSrc).not.toContain('unsafe-inline');
    // Attribute-level directives still needed by ~184 handlers in page
    // bundles (not index.html) + inline style= on dynamic elements.
    expect(csp).toContain("script-src-attr 'unsafe-inline'");
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
    // Telegram Mini App iframe must keep working.
    const frameAncestors = /frame-ancestors ([^;]+)/.exec(csp)![1];
    expect(frameAncestors).toContain('https://web.telegram.org');
    expect(frameAncestors).toContain('https://*.telegram.org');
    // script-src still pins to self + the one allowed external host.
    const scriptSrc = /script-src ([^;]+)/.exec(csp)![1];
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).toContain('https://telegram.org');
  });

  it('GET /avatars/:id с реальными данными — сохраняет свой Cache-Control, не перезаписан в no-store', async () => {
    const fx = new TestFixtures();
    try {
      const org = await fx.createOrg('Avatar Cache Org');
      const employee = await fx.createEmployee(org, { role: 'employee' });
      await employeesRepo.setAvatar(employee.id, Buffer.from('fake-jpeg-bytes'), 'image/jpeg');

      const app = await getApp();
      // GET /avatars/:id теперь требует auth + ту же сеть (hotfix — был
      // публичным IDOR, см. api/routes/me/avatar.ts).
      const res = await app.inject({ method: 'GET', url: `/avatars/${employee.id}`, headers: authAs(employee.telegramId) });
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('private, max-age=300');
    } finally {
      await fx.cleanup();
    }
  });
});
