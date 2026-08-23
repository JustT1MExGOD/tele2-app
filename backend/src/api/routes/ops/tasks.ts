/**
 * Tasks / Action System (18.4) — замыкает цикл данные → alert → action →
 * task → result, который Command Center (18.1) начал, но не заканчивал:
 * его кнопки действий только открывали существующие экраны. Архитектура
 * зеркалит support_tickets + support_messages (сущность со статусом +
 * отдельный тред комментариев) — тот же, уже отработанный паттерн.
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import {
  requireAuth,
  requireManagerOrSupervisor,
  resolveViewOrgId,
  assertEmployeeInOrg,
  requireEmployeeInOrg,
  requireStoreInOrg
} from '../../../auth/guards.js';
import { notifyUser } from '../../../integrations/telegram/bot.js';
import * as tasksRepo from '../../../data/repositories/tasks.js';
import * as employeesRepo from '../../../data/repositories/employees.js';
import * as alertsRepo from '../../../data/repositories/alerts.js';
import type {
  TasksListResponse,
  TaskDetailResponse,
  ChangeTaskStatusResponse,
  AddTaskCommentResponse,
  CreateTaskResponse
} from '../../../shared/api-types.js';

// Null первым в каждом Union — ajv (coerceTypes) иначе коэрсит null на
// первой подходящей ветке ДО того, как дойдёт до Null() (см. README §24,
// найдено в 19.19.0 на geoCoords()). due_at здесь реально поддерживает
// сброс на null в самом обработчике (b.due_at ? new Date(...) : null).
const PostTaskBody = Type.Object({
  title: Type.String({ minLength: 1 }),
  assigned_to: Type.Number(),
  description: Type.Optional(Type.String()),
  store_id: Type.Optional(Type.String()),
  alert_id: Type.Optional(Type.Number()),
  priority: Type.Optional(Type.String()),
  due_at: Type.Optional(Type.Union([Type.Null(), Type.String()])),
  org_id: Type.Optional(Type.String())
});
type PostTaskBody = Static<typeof PostTaskBody>;

const TaskCommentBody = Type.Object({
  body: Type.String({ minLength: 1 })
});
type TaskCommentBody = Static<typeof TaskCommentBody>;

const TaskStatusBody = Type.Object({
  status: Type.String({ minLength: 1 }),
  comment: Type.Optional(Type.String())
});
type TaskStatusBody = Static<typeof TaskStatusBody>;

const PatchTaskBody = Type.Object({
  assigned_to: Type.Optional(Type.Number()),
  priority: Type.Optional(Type.String()),
  due_at: Type.Optional(Type.Union([Type.Null(), Type.String()])),
  org_id: Type.Optional(Type.String())
});
type PatchTaskBody = Static<typeof PatchTaskBody>;

const VALID_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const VALID_STATUSES = new Set(['open', 'in_progress', 'done', 'cancelled']);

async function getTaskOr404(id: number, reply: any) {
  const task = await tasksRepo.getById(id);
  if (!task) {
    reply.code(404).send({ error: 'not found' });
    return null;
  }
  return task;
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
  await tasksRepo.addComment(taskId, authorId, body).catch(() => {});
}

export async function registerTasksRoutes(app: FastifyInstance) {
  app.post(
    '/tasks',
    {
      preHandler: [
        requireEmployeeInOrg('body', 'assigned_to', { allowOrgOverride: true }),
        requireStoreInOrg('body', 'store_id', { allowOrgOverride: true, optional: true })
      ],
      schema: { body: PostTaskBody }
    },
    async (request, reply): Promise<CreateTaskResponse | FastifyReply | undefined> => {
    if (!requireManagerOrSupervisor(request, reply)) return;
    const b = request.body as PostTaskBody;
    const title = String(b.title || '').trim();
    if (!title) return reply.code(400).send({ error: 'title required' });
    const assignedTo = Number(b.assigned_to);
    if (!assignedTo) return reply.code(400).send({ error: 'assigned_to required' });

    const orgId = resolveViewOrgId(request.user!, b.org_id);
    const storeId = b.store_id ? String(b.store_id) : null;
    const priority = VALID_PRIORITIES.has(b.priority) ? b.priority : 'normal';
    const dueAt = b.due_at ? new Date(b.due_at) : null;

    const task = await tasksRepo.create({
      orgId,
      title,
      description: b.description || null,
      createdBy: request.user!.employee_id,
      assignedTo,
      storeId,
      alertId: b.alert_id ? Number(b.alert_id) : null,
      priority,
      dueAt
    });

    try {
      const emp = await employeesRepo.getContactInfo(assignedTo);
      if (emp?.telegram_id) {
        await notifyUser(
          emp.telegram_id,
          `🆕 <b>Новая задача</b>\n\n${title}${b.description ? '\n' + b.description : ''}`
        );
      }
    } catch (_) {}

    return task;
    }
  );

  // Список задач сети (менеджер/супервайзер/admin) — фильтры status/assigned_to.
  app.get('/tasks', async (request, reply): Promise<TasksListResponse | undefined> => {
    if (!requireManagerOrSupervisor(request, reply)) return;
    const q = (request.query || {}) as { status?: string; assigned_to?: string; org_id?: string };
    const orgId = resolveViewOrgId(request.user!, q.org_id);

    const status = q.status && VALID_STATUSES.has(q.status) ? q.status : undefined;
    const assignedTo = q.assigned_to ? Number(q.assigned_to) : undefined;
    return tasksRepo.listForOrg(orgId, status, assignedTo);
  });

  // Свои задачи (любой активный сотрудник).
  app.get('/tasks/my', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    return tasksRepo.listForAssignee(request.user!.employee_id!);
  });

  app.get('/tasks/:id', async (request, reply): Promise<TaskDetailResponse | FastifyReply | undefined> => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const task = await getTaskOr404(Number(id), reply);
    if (!task) return;
    if (!(await canAccessTask(task, request.user!))) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const comments = await tasksRepo.getComments(task.id);
    return { task, comments };
  });

  app.post(
    '/tasks/:id/comments',
    { schema: { body: TaskCommentBody } },
    async (request, reply): Promise<AddTaskCommentResponse | FastifyReply | undefined> => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const task = await getTaskOr404(Number(id), reply);
    if (!task) return;
    if (!(await canAccessTask(task, request.user!))) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const body = String((request.body as TaskCommentBody)?.body || '').trim();
    if (!body) return reply.code(400).send({ error: 'body required' });

    const comment = await tasksRepo.addComment(task.id, request.user!.employee_id!, body);
    await tasksRepo.touchUpdatedAt(task.id);
    return comment;
    }
  );

  // Смена статуса. Исполнитель — open/in_progress/done; менеджер/супервайзер/
  // admin (той же сети) — плюс cancelled и возврат в open (reopen).
  app.post(
    '/tasks/:id/status',
    { schema: { body: TaskStatusBody } },
    async (request, reply): Promise<ChangeTaskStatusResponse | FastifyReply | undefined> => {
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

    const status = String((request.body as TaskStatusBody)?.status || '');
    if (!VALID_STATUSES.has(status)) {
      return reply.code(400).send({ error: 'invalid status' });
    }
    if (status === 'cancelled' && !isManagerOfOrg) {
      return reply.code(403).send({ error: 'forbidden', message: 'Отменить задачу может только менеджер' });
    }

    const comment = String((request.body as TaskStatusBody)?.comment || '').trim();
    const updated = await tasksRepo.setStatus(task.id, status);

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
        const creator = await employeesRepo.getContactInfo(task.created_by);
        if (creator?.telegram_id) {
          await notifyUser(creator.telegram_id, `✅ <b>Задача выполнена</b>\n\n${task.title}`);
        }
      } catch (_) {}

      // 18.6: «результат» из формулировки роадмапа для alerts — задача,
      // созданная из алерта (Command Center create_task с alert_id), сама
      // закрывает его при выполнении, без отдельного ручного шага в
      // «Алертах». Не трогаем уже resolved/dismissed — не переоткрываем.
      if (task.alert_id) {
        await alertsRepo.resolveFromTask(task.alert_id, user.employee_id).catch(() => {});
      }
    }

    return updated;
    }
  );

  // Переназначить / поменять приоритет / дедлайн — только менеджер/
  // супервайзер/admin своей сети.
  app.patch(
    '/tasks/:id',
    { schema: { body: PatchTaskBody } },
    async (request, reply) => {
    if (!requireManagerOrSupervisor(request, reply)) return;
    const { id } = request.params as { id: string };
    const task = await getTaskOr404(Number(id), reply);
    if (!task) return;
    if (task.org_id !== request.user!.org_id && request.user!.role !== 'admin') {
      return reply.code(403).send({ error: 'forbidden' });
    }

    const b = (request.body || {}) as PatchTaskBody;
    const patch: tasksRepo.TaskPatch = {};
    if (b.assigned_to !== undefined) {
      const newAssignee = Number(b.assigned_to);
      if (!(await assertEmployeeInOrg(newAssignee, task.org_id))) {
        return reply.code(403).send({ error: 'forbidden', message: 'Сотрудник не принадлежит вашей сети' });
      }
      patch.assigned_to = newAssignee;
    }
    if (b.priority !== undefined && VALID_PRIORITIES.has(b.priority)) {
      patch.priority = b.priority;
    }
    if (b.due_at !== undefined) {
      patch.due_at = b.due_at ? new Date(b.due_at) : null;
    }
    if (!Object.keys(patch).length) return reply.code(400).send({ error: 'no fields' });

    return tasksRepo.updatePatch(task.id, patch);
    }
  );
}
