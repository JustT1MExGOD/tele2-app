/**
 * 20.49.0 (Web Security & Trust Layer, часть 2) — регресс-тест на уже
 * корректное поведение (helmet-дефолты) плюс новый Cache-Control:no-store
 * хук (app.ts). Без этого теста будущая правка app.ts могла бы молча
 * выключить nosniff/no-referrer или сломать хук — раньше не было
 * проверено вообще, только "правильно по построению".
 */
import { describe, it, expect } from 'vitest';
import { getApp } from '../helpers/app.js';
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

  it('GET /avatars/:id с реальными данными — сохраняет свой Cache-Control, не перезаписан в no-store', async () => {
    const fx = new TestFixtures();
    try {
      const org = await fx.createOrg('Avatar Cache Org');
      const employee = await fx.createEmployee(org, { role: 'employee' });
      await employeesRepo.setAvatar(employee.id, Buffer.from('fake-jpeg-bytes'), 'image/jpeg');

      const app = await getApp();
      const res = await app.inject({ method: 'GET', url: `/avatars/${employee.id}` });
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('private, max-age=300');
    } finally {
      await fx.cleanup();
    }
  });
});
