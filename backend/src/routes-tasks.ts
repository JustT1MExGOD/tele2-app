/**
 * Tasks / Action System (18.4) — замыкает цикл данные → alert → action →
 * task → result, который Command Center (18.1) начал, но не заканчивал:
 * его кнопки действий только открывали существующие экраны. Архитектура
 * зеркалит support_tickets + support_messages (сущность со статусом +
 * отдельный тред комментариев) — тот же, уже отработанный паттерн.
 */
import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import {
  requireAuth,
  requireManagerOrSupervisor,
  resolveViewOrgId,
  assertEmployeeInOrg,
  assertStoreInOrg
} from './middleware-auth.js';
import { notifyUser } from './bot/index.js';

const VALID_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const VALID_STATUSES = new Set(['open', 'in_progress', 'done', 'cancelled']);

async function getTaskOr404(id: number, reply: any) {
  const res = await query(`SELECT * FROM tasks WHERE id = $1`, [id]);
  if (!res.rows[0]) {
    reply.code(404).send({ error: 'not found' });
    return null;
  }
  return res.rows[0];
}

/** Исполнитель или менеджер/супервайзер/admin той же сети, что задача. */
async function canAccessTask(task: any, user: any): Promise<boolean> {
  if (Number(task.assigned_to) === Number(user.employee_id)) return true;
  if (Number(task.created_by) === Number(user.employee_id)) return true;
  if (user.role === 'manager' || user.role === 'admin' || user.role === 'supervisor' || user.role === 'senior') {
    return task.org_id === user.org_id || user.role === 'admin';
  }
  return false;
}

async function addSystemComment(taskId: number, authorId: number, body: string) {
  await query(
    `INSERT INTO task_comments (task_id, author_id, body) VALUES ($1, $2, $3)`,
    [taskId, authorId, body]
  ).catch(() => {});
}

export async function registerTasksRoutes(app: FastifyInstance) {
  app.post('/tasks', async (request, reply) => {
    if (!requireManagerOrSupervisor(request, reply)) return;
    const b = (request.body || {}) as any;
    const title = String(b.title || '').trim();
    if (!title) return reply.code(400).send({ error: 'title required' });
    const assignedTo = Number(b.assigned_to);
    if (!assignedTo) return reply.code(400).send({ error: 'assigned_to required' });

    const orgId = resolveViewOrgId(request.user!, b.org_id);
    if (!(await assertEmployeeInOrg(assignedTo, orgId))) {
      return reply.code(403).send({ error: 'forbidden', message: 'Сотрудник не принадлежит вашей сети' });
    }
    const storeId = b.store_id ? String(b.store_id) : null;
    if (storeId && !(await assertStoreInOrg(storeId, orgId))) {
      return reply.code(403).send({ error: 'forbidden', message: 'Точка не принадлежит вашей сети' });
    }
    const priority = VALID_PRIORITIES.has(b.priority) ? b.priority : 'normal';
    const dueAt = b.due_at ? new Date(b.due_at) : null;

    const res = await query(
      `INSERT INTO tasks (org_id, title, description, created_by, assigned_to, store_id, alert_id, priority, due_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        orgId,
        title,
        b.description || null,
        request.user!.employee_id,
        assignedTo,
        storeId,
        b.alert_id ? Number(b.alert_id) : null,
        priority,
        dueAt
      ]
    );
    const task = res.rows[0];

    try {
      const emp = await query(`SELECT telegram_id, full_name FROM employees WHERE id = $1`, [assignedTo]);
      if (emp.rows[0]?.telegram_id) {
        await notifyUser(
          emp.rows[0].telegram_id,
          `🆕 <b>Новая задача</b>\n\n${title}${b.description ? '\n' + b.description : ''}`
        );
      }
    } catch (_) {}

    return task;
  });

  // Список задач сети (менеджер/супервайзер/admin) — фильтры status/assigned_to.
  app.get('/tasks', async (request, reply) => {
    if (!requireManagerOrSupervisor(request, reply)) return;
    const q = (request.query || {}) as { status?: string; assigned_to?: string; org_id?: string };
    const orgId = resolveViewOrgId(request.user!, q.org_id);

    const conditions = ['t.org_id = $1'];
    const params: any[] = [orgId];
    if (q.status && VALID_STATUSES.has(q.status)) {
      params.push(q.status);
      conditions.push(`t.status = $${params.length}`);
    }
    if (q.assigned_to) {
      params.push(Number(q.assigned_to));
      conditions.push(`t.assigned_to = $${params.length}`);
    }

    const res = await query(
      `SELECT t.*, e.full_name as assignee_name, st.name as store_name
       FROM tasks t
       LEFT JOIN employees e ON e.id = t.assigned_to
       LEFT JOIN stores st ON st.id = t.store_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, t.created_at DESC
       LIMIT 200`,
      params
    );
    return res.rows;
  });

  // Свои задачи (любой активный сотрудник).
  app.get('/tasks/my', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const res = await query(
      `SELECT t.*, st.name as store_name
       FROM tasks t
       LEFT JOIN stores st ON st.id = t.store_id
       WHERE t.assigned_to = $1
       ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, t.due_at NULLS LAST, t.created_at DESC
       LIMIT 100`,
      [request.user!.employee_id]
    );
    return res.rows;
  });

  app.get('/tasks/:id', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const task = await getTaskOr404(Number(id), reply);
    if (!task) return;
    if (!(await canAccessTask(task, request.user!))) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const comments = await query(
      `SELECT c.*, e.full_name as author_name
       FROM task_comments c
       LEFT JOIN employees e ON e.id = c.author_id
       WHERE c.task_id = $1 ORDER BY c.created_at ASC`,
      [task.id]
    );
    return { task, comments: comments.rows };
  });

  app.post('/tasks/:id/comments', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const task = await getTaskOr404(Number(id), reply);
    if (!task) return;
    if (!(await canAccessTask(task, request.user!))) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const body = String((request.body as any)?.body || '').trim();
    if (!body) return reply.code(400).send({ error: 'body required' });

    const res = await query(
      `INSERT INTO task_comments (task_id, author_id, body) VALUES ($1,$2,$3) RETURNING *`,
      [task.id, request.user!.employee_id, body]
    );
    await query(`UPDATE tasks SET updated_at = now() WHERE id = $1`, [task.id]);
    return res.rows[0];
  });

  // Смена статуса. Исполнитель — open/in_progress/done; менеджер/супервайзер/
  // admin (той же сети) — плюс cancelled и возврат в open (reopen).
  app.post('/tasks/:id/status', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const task = await getTaskOr404(Number(id), reply);
    if (!task) return;

    const user = request.user!;
    const isAssignee = Number(task.assigned_to) === Number(user.employee_id);
    const isManagerOfOrg =
      (user.role === 'manager' || user.role === 'admin' || user.role === 'supervisor' || user.role === 'senior') &&
      (task.org_id === user.org_id || user.role === 'admin');
    if (!isAssignee && !isManagerOfOrg) {
      return reply.code(403).send({ error: 'forbidden' });
    }

    const status = String((request.body as any)?.status || '');
    if (!VALID_STATUSES.has(status)) {
      return reply.code(400).send({ error: 'invalid status' });
    }
    if (status === 'cancelled' && !isManagerOfOrg) {
      return reply.code(403).send({ error: 'forbidden', message: 'Отменить задачу может только менеджер' });
    }

    const comment = String((request.body as any)?.comment || '').trim();
    const completedAt = status === 'done' ? 'now()' : 'NULL';
    const res = await query(
      `UPDATE tasks SET status = $1, updated_at = now(), completed_at = ${completedAt} WHERE id = $2 RETURNING *`,
      [status, task.id]
    );

    const statusLabel: Record<string, string> = {
      open: 'открыта заново',
      in_progress: 'в работе',
      done: 'выполнена',
      cancelled: 'отменена'
    };
    await addSystemComment(
      task.id,
      user.employee_id!,
      `Статус изменён на «${statusLabel[status]}»${comment ? ': ' + comment : ''}`
    );

    // Замыкаем цикл на менеджера — он видит, что задача выполнена, без
    // необходимости самому проверять список.
    if (status === 'done' && task.created_by) {
      try {
        const creator = await query(`SELECT telegram_id FROM employees WHERE id = $1`, [task.created_by]);
        if (creator.rows[0]?.telegram_id) {
          await notifyUser(creator.rows[0].telegram_id, `✅ <b>Задача выполнена</b>\n\n${task.title}`);
        }
      } catch (_) {}
    }

    return res.rows[0];
  });

  // Переназначить / поменять приоритет / дедлайн — только менеджер/
  // супервайзер/admin своей сети.
  app.patch('/tasks/:id', async (request, reply) => {
    if (!requireManagerOrSupervisor(request, reply)) return;
    const { id } = request.params as { id: string };
    const task = await getTaskOr404(Number(id), reply);
    if (!task) return;
    if (task.org_id !== request.user!.org_id && request.user!.role !== 'admin') {
      return reply.code(403).send({ error: 'forbidden' });
    }

    const b = (request.body || {}) as any;
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    if (b.assigned_to !== undefined) {
      const newAssignee = Number(b.assigned_to);
      if (!(await assertEmployeeInOrg(newAssignee, task.org_id))) {
        return reply.code(403).send({ error: 'forbidden', message: 'Сотрудник не принадлежит вашей сети' });
      }
      sets.push(`assigned_to = $${i++}`);
      vals.push(newAssignee);
    }
    if (b.priority !== undefined && VALID_PRIORITIES.has(b.priority)) {
      sets.push(`priority = $${i++}`);
      vals.push(b.priority);
    }
    if (b.due_at !== undefined) {
      sets.push(`due_at = $${i++}`);
      vals.push(b.due_at ? new Date(b.due_at) : null);
    }
    if (!sets.length) return reply.code(400).send({ error: 'no fields' });
    sets.push('updated_at = now()');
    vals.push(task.id);

    const res = await query(
      `UPDATE tasks SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      vals
    );
    return res.rows[0];
  });
}
