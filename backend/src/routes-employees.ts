/**
 * CRUD сотрудников и точек (manager/admin).
 *
 * Раньше жил в routes-v4.ts, который нигде не был зарегистрирован в
 * index.ts — то есть создать/отредактировать сотрудника или точку через
 * API было физически невозможно (единственный путь — approve заявки на
 * доступ). Вынесено сюда и подключено.
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { withTransaction } from './db/index.js';
import { requireActive, requireManager, canAssignRole, resolveViewOrgId, requireEmployeeInOrg, Role } from './middleware-auth.js';
import { record as recordAudit } from './repositories/audit.js';
import * as employeesRepo from './repositories/employees.js';
import * as schedulesRepo from './repositories/schedules.js';
import type { EmployeesListResponse, CreateEmployeeResponse } from './shared/api-types.js';

const PostEmployeeBody = Type.Object({
  full_name: Type.String({ minLength: 1 }),
  short_name: Type.Optional(Type.String()),
  role: Type.Optional(Type.String()),
  org_id: Type.Optional(Type.String())
});
type PostEmployeeBody = Static<typeof PostEmployeeBody>;

const PatchEmployeeBody = Type.Object({
  full_name: Type.Optional(Type.String()),
  short_name: Type.Optional(Type.String()),
  is_active: Type.Optional(Type.Boolean()),
  org_id: Type.Optional(Type.String())
});
type PatchEmployeeBody = Static<typeof PatchEmployeeBody>;

export async function registerEmployeesRoutes(app: FastifyInstance) {
  app.get('/employees', async (request, reply): Promise<EmployeesListResponse | undefined> => {
    if (!requireActive(request, reply)) return;
    // telegram_id отдаём только manager-tier (manager/senior/admin) — рядовым сотрудникам он не нужен
    const canSeeTelegramId =
      request.user!.role === 'manager' || request.user!.role === 'admin' || request.user!.role === 'senior';
    // «Команда» — это сотрудники СВОЕЙ сети, а не всех сетей вперемешку.
    // admin по умолчанию тоже видит только свою (рабочую) сеть; чтобы
    // заглянуть в другую — ?org_id=, доступно только admin (переключатель сети в UI).
    const q = request.query as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, q.org_id);
    return employeesRepo.listActiveByOrg(orgId, canSeeTelegramId);
  });

  // ===== EMPLOYEES CRUD =====
  app.post(
    '/employees',
    { schema: { body: PostEmployeeBody } },
    async (request, reply): Promise<CreateEmployeeResponse | FastifyReply | undefined> => {
    if (!requireManager(request, reply)) return;
    const b = request.body as PostEmployeeBody;
    const full_name = String(b.full_name || '').trim();
    if (!full_name) return reply.code(400).send({ error: 'full_name required' });
    const short_name = b.short_name || full_name.split(/\s+/)[1] || full_name;
    const ALL_ROLES: Role[] = ['trainee', 'employee', 'senior', 'manager', 'supervisor', 'admin'];
    const requested = ALL_ROLES.includes(b.role as Role) ? (b.role as Role) : 'employee';
    // Каскад: можно завести сотрудника только с ролью строго ниже своей (admin — без ограничений).
    const role: Role = canAssignRole(request.user!.role, requested) ? requested : 'employee';

    // Новый сотрудник попадает в сеть создающего его менеджера; admin может
    // явно указать другую сеть (переключатель сети в UI шлёт org_id).
    const org_id = resolveViewOrgId(request.user!, b.org_id);
    return employeesRepo.createEmployee(full_name, short_name, role, org_id);
    }
  );

  app.patch(
    '/employees/:id',
    // Раньше без проверки — manager любой сети мог переименовать/деактивировать
    // сотрудника вообще любой другой сети по угаданному (маленькому, последовательному) id.
    {
      preHandler: [requireEmployeeInOrg('params', 'id', { allowOrgOverride: true })],
      schema: { body: PatchEmployeeBody }
    },
    async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const b = request.body as PatchEmployeeBody;
    const patch: employeesRepo.EmployeePatch = {};
    if (b.full_name !== undefined) patch.full_name = String(b.full_name).trim();
    if (b.short_name !== undefined) patch.short_name = b.short_name;
    if (b.is_active !== undefined) patch.is_active = !!b.is_active;
    // роль намеренно не меняется здесь — для этого есть отдельные
    // /employees/:id/role (v3) и PATCH /employees/:id/role (v8),
    // которые дополнительно назначают точки супервайзеру.
    if (!Object.keys(patch).length) return reply.code(400).send({ error: 'no fields' });

    // Аудит — только когда реально меняется is_active (деактивация/
    // восстановление — чувствительное действие), не на каждый rename.
    if (b.is_active !== undefined) {
      const orgId = resolveViewOrgId(request.user!, b.org_id);
      const before = await employeesRepo.getIsActive(Number(id));
      const row = await withTransaction(async (q) => {
        const res = await employeesRepo.updateFields(Number(id), patch, q);
        if (res) {
          await recordAudit({
            orgId,
            actorEmployeeId: request.user!.employee_id,
            actorTelegramId: request.user!.telegram_id ? Number(request.user!.telegram_id) : null,
            action: 'employee.deactivate',
            targetType: 'employee',
            targetId: id,
            before: { is_active: before ?? null },
            after: { is_active: !!b.is_active },
            requestId: request.id
          }, q);
        }
        return res;
      });
      return row || reply.code(404).send({ error: 'not found' });
    }

    const res = await employeesRepo.updateFields(Number(id), patch);
    return res || reply.code(404).send({ error: 'not found' });
    }
  );

  app.delete(
    '/employees/:id',
    { preHandler: [requireEmployeeInOrg('params', 'id', { allowOrgOverride: true })] },
    async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const { org_id } = (request.query || {}) as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, org_id);

    const row = await withTransaction(async (q) => {
      // soft delete — отвязываем telegram, но продажи/историю не трогаем
      const res = await employeesRepo.softDeactivate(Number(id), q);
      if (!res) return null;

      await recordAudit({
        orgId,
        actorEmployeeId: request.user!.employee_id,
        actorTelegramId: request.user!.telegram_id ? Number(request.user!.telegram_id) : null,
        action: 'employee.deactivate',
        targetType: 'employee',
        targetId: id,
        before: { is_active: true },
        after: { is_active: false },
        requestId: request.id
      }, q);

      return res;
    });

    if (!row) return reply.code(404).send({ error: 'not found' });

    // Будущие смены — не история, а обещание, что человек выйдет на
    // работу. GET /schedules/live-map их не фильтрует по is_active — без
    // очистки уволенный сотрудник продолжал бы висеть в завтрашнем графике
    // и учитываться в покрытии точки, будто он реально выйдет. Прошлые
    // смены (реальная история — кто фактически работал) не трогаем. Вне
    // транзакции сознательно — best-effort очистка, не обязана откатывать
    // уже подтверждённое увольнение при своей неудаче.
    await schedulesRepo.deleteFutureForEmployee(Number(id))
      .catch((e: any) => console.error('cleanup future schedules on employee delete:', e?.message || e));

    return { ok: true, ...row };
    }
  );
}
