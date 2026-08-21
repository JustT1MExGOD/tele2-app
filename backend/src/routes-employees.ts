/**
 * CRUD сотрудников и точек (manager/admin).
 *
 * Раньше жил в routes-v4.ts, который нигде не был зарегистрирован в
 * index.ts — то есть создать/отредактировать сотрудника или точку через
 * API было физически невозможно (единственный путь — approve заявки на
 * доступ). Вынесено сюда и подключено.
 */
import { FastifyInstance } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { query, withTransaction } from './db/index.js';
import { requireActive, requireManager, canAssignRole, resolveViewOrgId, requireEmployeeInOrg, Role } from './middleware-auth.js';
import { recordAudit } from './services/audit.js';

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
  app.get('/employees', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    // telegram_id отдаём только manager-tier (manager/senior/admin) — рядовым сотрудникам он не нужен
    const canSeeTelegramId =
      request.user!.role === 'manager' || request.user!.role === 'admin' || request.user!.role === 'senior';
    // «Команда» — это сотрудники СВОЕЙ сети, а не всех сетей вперемешку.
    // admin по умолчанию тоже видит только свою (рабочую) сеть; чтобы
    // заглянуть в другую — ?org_id=, доступно только admin (переключатель сети в UI).
    const q = request.query as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, q.org_id);
    const res = await query(
      `SELECT id, full_name, short_name, ${canSeeTelegramId ? 'telegram_id,' : ''} is_active, role
       FROM employees
       WHERE is_active = true AND COALESCE(org_id, 'default') = $1
       ORDER BY id`,
      [orgId]
    );
    return res.rows;
  });

  // ===== EMPLOYEES CRUD =====
  app.post(
    '/employees',
    { schema: { body: PostEmployeeBody } },
    async (request, reply) => {
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
    const res = await query(
      `INSERT INTO employees (full_name, short_name, role, is_active, org_id)
       VALUES ($1, $2, $3, true, $4)
       RETURNING id, full_name, short_name, role, is_active, telegram_id, org_id`,
      [full_name, short_name, role, org_id]
    );
    return res.rows[0];
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
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    if (b.full_name !== undefined) {
      sets.push(`full_name = $${i++}`);
      vals.push(String(b.full_name).trim());
    }
    if (b.short_name !== undefined) {
      sets.push(`short_name = $${i++}`);
      vals.push(b.short_name);
    }
    if (b.is_active !== undefined) {
      sets.push(`is_active = $${i++}`);
      vals.push(!!b.is_active);
    }
    // роль намеренно не меняется здесь — для этого есть отдельные
    // /employees/:id/role (v3) и PATCH /employees/:id/role (v8),
    // которые дополнительно назначают точки супервайзеру.
    if (!sets.length) return reply.code(400).send({ error: 'no fields' });
    vals.push(Number(id));

    // Аудит — только когда реально меняется is_active (деактивация/
    // восстановление — чувствительное действие), не на каждый rename.
    if (b.is_active !== undefined) {
      const orgId = resolveViewOrgId(request.user!, b.org_id);
      const before = await query(`SELECT is_active FROM employees WHERE id = $1`, [Number(id)]);
      const row = await withTransaction(async (q) => {
        const res = await q(
          `UPDATE employees SET ${sets.join(', ')} WHERE id = $${i}
           RETURNING id, full_name, short_name, role, is_active, telegram_id`,
          vals
        );
        if (res.rows[0]) {
          await recordAudit(q, {
            orgId,
            actorEmployeeId: request.user!.employee_id,
            actorTelegramId: request.user!.telegram_id ? Number(request.user!.telegram_id) : null,
            action: 'employee.deactivate',
            targetType: 'employee',
            targetId: id,
            before: { is_active: before.rows[0]?.is_active ?? null },
            after: { is_active: !!b.is_active },
            requestId: request.id
          });
        }
        return res.rows[0];
      });
      return row || reply.code(404).send({ error: 'not found' });
    }

    const res = await query(
      `UPDATE employees SET ${sets.join(', ')} WHERE id = $${i}
       RETURNING id, full_name, short_name, role, is_active, telegram_id`,
      vals
    );
    return res.rows[0] || reply.code(404).send({ error: 'not found' });
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
      const res = await q(
        `UPDATE employees SET is_active = false, telegram_id = NULL WHERE id = $1
         RETURNING id, full_name, is_active`,
        [Number(id)]
      );
      if (!res.rows[0]) return null;

      await recordAudit(q, {
        orgId,
        actorEmployeeId: request.user!.employee_id,
        actorTelegramId: request.user!.telegram_id ? Number(request.user!.telegram_id) : null,
        action: 'employee.deactivate',
        targetType: 'employee',
        targetId: id,
        before: { is_active: true },
        after: { is_active: false },
        requestId: request.id
      });

      return res.rows[0];
    });

    if (!row) return reply.code(404).send({ error: 'not found' });

    // Будущие смены — не история, а обещание, что человек выйдет на
    // работу. GET /schedules/live-map их не фильтрует по is_active — без
    // очистки уволенный сотрудник продолжал бы висеть в завтрашнем графике
    // и учитываться в покрытии точки, будто он реально выйдет. Прошлые
    // смены (реальная история — кто фактически работал) не трогаем. Вне
    // транзакции сознательно — best-effort очистка, не обязана откатывать
    // уже подтверждённое увольнение при своей неудаче.
    await query(
      `DELETE FROM schedules WHERE employee_id = $1 AND work_date::date >= (now() AT TIME ZONE 'Europe/Moscow')::date`,
      [Number(id)]
    ).catch((e: any) => console.error('cleanup future schedules on employee delete:', e?.message || e));

    return { ok: true, ...row };
    }
  );
}
