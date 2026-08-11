import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';

// Регрессия: GET /bfq и GET /bfq/:employeeId были вообще без авторизации —
// кто угодно без токена мог узнать BFQ любого сотрудника любой сети по id.
// Найдено и закрыто в этом же заходе (эпик 17.0, третья волна).
describe('Изоляция BFQ (/bfq)', () => {
  const fx = new TestFixtures();
  let orgA: string, orgB: string;
  let managerA: { id: number; telegramId: number };
  let managerB: { id: number; telegramId: number };
  let employeeA: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A');
    orgB = await fx.createOrg('Org B');
    managerA = await fx.createEmployee(orgA, { role: 'manager' });
    managerB = await fx.createEmployee(orgB, { role: 'manager' });
    employeeA = await fx.createEmployee(orgA, { role: 'employee', fullName: 'BFQ Employee A' });
  });

  afterAll(() => fx.cleanup());

  it('GET /bfq без токена — 401', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/bfq' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /bfq — чужая сеть не видит сотрудника другой сети', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/bfq', headers: authAs(managerB.telegramId) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.find((i: any) => Number(i.employee_id) === employeeA.id)).toBeUndefined();
  });

  it('GET /bfq — своя сеть видит сотрудника', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/bfq', headers: authAs(managerA.telegramId) });
    const body = res.json();
    expect(body.items.find((i: any) => Number(i.employee_id) === employeeA.id)).toBeDefined();
  });

  it('GET /bfq/:employeeId — чужая сеть получает 403 на чужого сотрудника', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/bfq/${employeeA.id}`,
      headers: authAs(managerB.telegramId)
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET /bfq/:employeeId — своя сеть может смотреть сотрудника', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/bfq/${employeeA.id}`,
      headers: authAs(managerA.telegramId)
    });
    expect(res.statusCode).toBe(200);
  });

  it('GET /bfq/:employeeId — сотрудник всегда может смотреть свой собственный показатель', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/bfq/${employeeA.id}`,
      headers: authAs(employeeA.telegramId)
    });
    expect(res.statusCode).toBe(200);
  });

  it('POST /bfq/manual — manager чужой сети получает 403 на чужого сотрудника', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/bfq/manual',
      headers: { ...authAs(managerB.telegramId), 'content-type': 'application/json' },
      payload: { employee_id: employeeA.id, vmr_avg: 5, penalty: 0 }
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST /bfq/manual — своя сеть может выставить VMR/штраф', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/bfq/manual',
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { employee_id: employeeA.id, vmr_avg: 5, penalty: 0 }
    });
    expect(res.statusCode).toBe(200);
  });

  // Регрессия: BFQ брал план из store_plans WHERE plan_date IS NULL —
  // строки, которая создаётся один раз нулями при создании точки и НИКОГДА
  // не обновляется. Реальный план сотрудника (employee_month_plans,
  // PUT /plans/employees/:id/month) в расчёт BFQ вообще не попадал —
  // менеджер мог сколько угодно менять план, BFQ его не видел никогда.
  it('PUT /plans/employees/:id/month — изменение плана сразу отражается в GET /bfq/:employeeId', async () => {
    const app = await getApp();
    const month = '2026-05';

    const setPlan = await app.inject({
      method: 'PUT',
      url: `/plans/employees/${employeeA.id}/month`,
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { month, sim: 40, mnp: 10 }
    });
    expect(setPlan.statusCode).toBe(200);

    const bfq1 = await app.inject({
      method: 'GET',
      url: `/bfq/${employeeA.id}?month=${month}`,
      headers: authAs(managerA.telegramId)
    });
    expect(bfq1.statusCode).toBe(200);
    const body1 = bfq1.json();
    expect(Number(body1.plan.sim)).toBe(40);
    expect(Number(body1.plan.mnp)).toBe(10);

    // Меняем план ещё раз — BFQ должен подхватить новое значение сразу,
    // без промежуточного шага материализации/крона.
    const setPlan2 = await app.inject({
      method: 'PUT',
      url: `/plans/employees/${employeeA.id}/month`,
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { month, sim: 100, mnp: 25 }
    });
    expect(setPlan2.statusCode).toBe(200);

    const bfq2 = await app.inject({
      method: 'GET',
      url: `/bfq/${employeeA.id}?month=${month}`,
      headers: authAs(managerA.telegramId)
    });
    const body2 = bfq2.json();
    expect(Number(body2.plan.sim)).toBe(100);
    expect(Number(body2.plan.mnp)).toBe(25);
  });
});
