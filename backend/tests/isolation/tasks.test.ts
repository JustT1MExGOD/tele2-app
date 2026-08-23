import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

// 18.4 Tasks / Action System — замыкает цикл data → alert → action → task →
// result, который Command Center (18.1) начал, но не заканчивал.
describe('Tasks (/tasks)', () => {
  const fx = new TestFixtures();
  let orgA: string, orgB: string;
  let storeA: string, storeB: string;
  let managerA: { id: number; telegramId: number };
  let managerB: { id: number; telegramId: number };
  let employeeA: { id: number; telegramId: number };
  let employeeB: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A');
    orgB = await fx.createOrg('Org B');
    storeA = await fx.createStore(orgA);
    storeB = await fx.createStore(orgB);
    managerA = await fx.createEmployee(orgA, { role: 'manager' });
    managerB = await fx.createEmployee(orgB, { role: 'manager' });
    employeeA = await fx.createEmployee(orgA, { role: 'employee', fullName: 'Task Employee A' });
    employeeB = await fx.createEmployee(orgB, { role: 'employee', fullName: 'Task Employee B' });
  });

  afterAll(async () => {
    await query(`DELETE FROM task_comments WHERE task_id IN (SELECT id FROM tasks WHERE created_by = ANY($1))`, [
      [managerA.id, managerB.id]
    ]);
    await query(`DELETE FROM tasks WHERE created_by = ANY($1)`, [[managerA.id, managerB.id]]);
    await fx.cleanup();
  });

  it('POST /tasks — без токена 401', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { 'content-type': 'application/json' },
      payload: { title: 'x', assigned_to: employeeA.id }
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /tasks — обычный сотрудник получает 403 (не может создавать задачи)', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
      payload: { title: 'x', assigned_to: employeeA.id }
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST /tasks — manager не может назначить задачу сотруднику чужой сети', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { title: 'Проверить остатки', assigned_to: employeeB.id }
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST /tasks — manager не может привязать задачу к точке чужой сети', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { title: 'Проверить кассу', assigned_to: employeeA.id, store_id: storeB }
    });
    expect(res.statusCode).toBe(403);
  });

  let taskId: number;

  it('POST /tasks — manager создаёт задачу сотруднику своей сети', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: {
        title: 'Проверить остатки после 18:00',
        description: 'Store A просела по MNP',
        assigned_to: employeeA.id,
        store_id: storeA,
        priority: 'high'
      }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('open');
    expect(Number(body.assigned_to)).toBe(employeeA.id);
    taskId = Number(body.id);
  });

  it('GET /tasks — manager другой сети не видит чужие задачи', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/tasks',
      headers: authAs(managerB.telegramId)
    });
    const body = res.json();
    expect(body.find((t: any) => Number(t.id) === taskId)).toBeUndefined();
  });

  it('GET /tasks — manager своей сети видит задачу', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/tasks',
      headers: authAs(managerA.telegramId)
    });
    const body = res.json();
    expect(body.find((t: any) => Number(t.id) === taskId)).toBeDefined();
  });

  it('GET /tasks/my — исполнитель видит свою задачу', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/tasks/my',
      headers: authAs(employeeA.telegramId)
    });
    const body = res.json();
    expect(body.find((t: any) => Number(t.id) === taskId)).toBeDefined();
  });

  it('GET /tasks/:id — посторонний сотрудник чужой сети получает 403', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/tasks/${taskId}`,
      headers: authAs(employeeB.telegramId)
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET /tasks/:id — исполнитель видит задачу с тредом комментариев', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/tasks/${taskId}`,
      headers: authAs(employeeA.telegramId)
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Number(body.task.id)).toBe(taskId);
    expect(Array.isArray(body.comments)).toBe(true);
  });

  it('POST /tasks/:id/status — исполнитель не может отменить задачу (только менеджер)', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/status`,
      headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
      payload: { status: 'cancelled' }
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST /tasks/:id/status — исполнитель переводит задачу в работу, потом выполняет', async () => {
    const app = await getApp();
    const inProgress = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/status`,
      headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
      payload: { status: 'in_progress' }
    });
    expect(inProgress.statusCode).toBe(200);
    expect(inProgress.json().status).toBe('in_progress');

    const done = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/status`,
      headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
      payload: { status: 'done', comment: 'Проверил, всё ок' }
    });
    expect(done.statusCode).toBe(200);
    const body = done.json();
    expect(body.status).toBe('done');
    expect(body.completed_at).toBeTruthy();
  });

  it('история статусов пишется в task_comments', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/tasks/${taskId}`,
      headers: authAs(managerA.telegramId)
    });
    const body = res.json();
    const systemComments = body.comments.filter((c: any) => String(c.body).includes('Статус изменён'));
    expect(systemComments.length).toBeGreaterThanOrEqual(2);
  });

  it('после выполнения задача больше не в /me/day.tasks (только open/in_progress)', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/me/day',
      headers: authAs(employeeA.telegramId)
    });
    const body = res.json();
    expect((body.tasks || []).find((t: any) => Number(t.id) === taskId)).toBeUndefined();
  });

  it('/me/day.tasks показывает незакрытую задачу', async () => {
    const app = await getApp();
    const create = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { title: 'Вторая задача', assigned_to: employeeA.id }
    });
    const newTaskId = Number(create.json().id);

    const res = await app.inject({
      method: 'GET',
      url: '/me/day',
      headers: authAs(employeeA.telegramId)
    });
    const body = res.json();
    expect((body.tasks || []).find((t: any) => Number(t.id) === newTaskId)).toBeDefined();
  });
});
