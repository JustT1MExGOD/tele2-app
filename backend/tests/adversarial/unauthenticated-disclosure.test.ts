import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';

/**
 * Изначально три роута не вызывали НИ ОДНОЙ auth-функции — отвечали кому
 * угодно вообще без единого заголовка:
 *  - GET /stores — весь список точек ВСЕХ сетей разом, без auth и без
 *    фильтра по org_id;
 *  - GET /plans — шаблоны план-показателей всех точек всех сетей, без auth;
 *  - GET /plans/employees/:id/daily — план И факт произвольного employee_id
 *    любой сети, без auth и без проверки принадлежности сети (в отличие
 *    от соседнего /month-роута, который обе проверки уже делал).
 *
 * Починено (routes-core.ts, routes-plans-v5.ts): все три теперь требуют
 * requireActive и скопированы по своей сети (resolveViewOrgId /
 * assertEmployeeInOrg) — тот же паттерн, что уже был у /org/stores и
 * /plans/employees/:id/month.
 */
describe('UNAUTHENTICATED DISCLOSURE (ПОЧИНЕНО): роуты теперь требуют auth и фильтруют по своей сети', () => {
  const fx = new TestFixtures();
  let orgA: string, orgB: string;
  let storeA: string, storeB: string;
  let employeeA: { id: number; telegramId: number };
  let employeeB: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A Disclosure');
    orgB = await fx.createOrg('Org B Disclosure');
    storeA = await fx.createStore(orgA, 'Store A Secret');
    storeB = await fx.createStore(orgB, 'Store B Secret');
    employeeA = await fx.createEmployee(orgA, { role: 'employee', fullName: 'Employee A' });
    employeeB = await fx.createEmployee(orgB, { role: 'employee', fullName: 'Employee B Private' });
  });

  afterAll(() => fx.cleanup());

  it('ПОЧИНЕНО: GET /stores без заголовка теперь 401', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/stores' });
    expect(res.statusCode).toBe(401);
  });

  it('ПОЧИНЕНО: GET /stores аутентифицированным сотрудником сети A отдаёт ТОЛЬКО точки сети A, не сети B', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/stores', headers: authAs(employeeA.telegramId) });
    expect(res.statusCode).toBe(200);
    const ids = res.json().map((s: any) => s.id);
    expect(ids).toContain(storeA);
    expect(ids).not.toContain(storeB);
  });

  it('ПОЧИНЕНО: GET /plans без заголовка теперь 401 (раньше 200 без единого auth-гейта)', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/plans' });
    expect(res.statusCode).toBe(401);
  });

  it('ПОЧИНЕНО: GET /plans/employees/:id/daily без заголовка теперь 401', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/plans/employees/${employeeB.id}/daily?date=2026-06-15`
    });
    expect(res.statusCode).toBe(401);
  });

  it('ПОЧИНЕНО: GET /plans/employees/:id/daily аутентифицированным сотрудником ЧУЖОЙ сети теперь 403, не отдаёт план/факт жертвы', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/plans/employees/${employeeB.id}/daily?date=2026-06-15`,
      headers: authAs(employeeA.telegramId)
    });
    expect(res.statusCode).toBe(403);
  });

  it('своя запись по-прежнему доступна: GET /plans/employees/:id/daily для СВОЕГО id работает как раньше', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/plans/employees/${employeeA.id}/daily?date=2026-06-15`,
      headers: authAs(employeeA.telegramId)
    });
    expect(res.statusCode).toBe(200);
    expect(Number(res.json().employee_id)).toBe(employeeA.id);
  });
});
