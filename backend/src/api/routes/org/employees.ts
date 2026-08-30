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
import { withTransaction } from '../../../data/db/index.js';
import { requireActive, requireManager, canAssignRole, resolveViewOrgId, requireEmployeeInOrg, isMfaMandatoryForRole, Role } from '../../../auth/guards.js';
import { record as recordAudit } from '../../../data/repositories/audit.js';
import { claimIdempotencyKey } from '../../../data/repositories/sync-log.js';
import * as employeesRepo from '../../../data/repositories/employees.js';
import * as schedulesRepo from '../../../data/repositories/schedules.js';
import * as supervisorSectorsRepo from '../../../data/repositories/supervisor-sectors.js';
import * as sessionsRepo from '../../../data/repositories/sessions.js';
import * as mfaRepo from '../../../data/repositories/mfa.js';
import { invalidate as invalidateScope } from '../../../core/shared/scope-cache.js';
import { assertStepUp } from '../../../auth/step-up.js';
import type { EmployeesListResponse, CreateEmployeeResponse } from '../../../shared/api-types.js';

const PostEmployeeBody = Type.Object({
  full_name: Type.String({ minLength: 1 }),
  short_name: Type.Optional(Type.String()),
  role: Type.Optional(Type.String()),
  org_id: Type.Optional(Type.String()),
  client_id: Type.Optional(Type.String())
});
type PostEmployeeBody = Static<typeof PostEmployeeBody>;

const PatchEmployeeBody = Type.Object({
  full_name: Type.Optional(Type.String()),
  short_name: Type.Optional(Type.String()),
  is_active: Type.Optional(Type.Boolean()),
  org_id: Type.Optional(Type.String())
});
type PatchEmployeeBody = Static<typeof PatchEmployeeBody>;

const EmployeeRoleBody = Type.Object({
  role: Type.String({ minLength: 1 }),
  org_id: Type.Optional(Type.String()),
  sector_id: Type.Optional(Type.String())
});
type EmployeeRoleBody = Static<typeof EmployeeRoleBody>;

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
    async (request, reply): Promise<CreateEmployeeResponse | { ok: true; deduped: true } | FastifyReply | undefined> => {
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

    // 20.50.0 — двойной тап/ретрай раньше молча создавал двух сотрудников с
    // одинаковым full_name/role/org_id: на employees нет UNIQUE на
    // (full_name, org_id), id — обычный serial, каждый INSERT проходит
    // независимо. Тот же приём, что уже в POST /tasks (claimIdempotencyKey,
    // race-safe UNIQUE(client_id) + ON CONFLICT DO NOTHING) — опциональный,
    // не ломает клиентов, которые ещё не шлют client_id.
    if (b.client_id) {
      const tg = request.user!.telegram_id ? Number(request.user!.telegram_id) : null;
      const fresh = await claimIdempotencyKey(String(b.client_id).slice(0, 128), request.user!.employee_id, tg, b);
      if (!fresh) return { ok: true, deduped: true };
    }

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
            requestId: request.id,
            actorRole: request.user!.role
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
        requestId: request.id,
        actorRole: request.user!.role
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

  // Назначить роль (+ сектор, если роль — supervisor). Слито из
  // routes-v8.ts (20.11.0, репо-реструктуризация) — тематически это CRUD
  // сотрудника, не access/сектор-назначение.
  app.patch(
    '/employees/:id/role',
    // Раньше без проверки — manager любой сети мог поменять роль (вплоть до
    // admin) вообще любому сотруднику любой другой сети по угаданному id.
    {
      preHandler: [requireEmployeeInOrg('params', 'id', { allowOrgOverride: true })],
      schema: { body: EmployeeRoleBody }
    },
    async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const b = request.body as EmployeeRoleBody;
    const role = b.role as Role;
    const ALL_ROLES: Role[] = ['trainee', 'employee', 'senior', 'manager', 'supervisor', 'admin'];
    if (!ALL_ROLES.includes(role)) {
      return reply.code(400).send({ error: 'bad role' });
    }
    // Каскад: можно назначить только роль строго ниже своей (admin — без ограничений).
    if (!canAssignRole(request.user!.role, role)) {
      return reply.code(403).send({ error: 'forbidden', message: 'Можно назначать только роли ниже своей' });
    }

    const beforeRole = await employeesRepo.getRole(Number(id));

    // Step-up (20.52.0, расширено 20.52.1 §12) — выдача ЛЮБОЙ MFA-mandatory
    // роли (не только admin — supervisor видит данные всего сектора,
    // тот же класс риска) требует свежего подтверждения MFA прямо перед
    // этим конкретным действием, не «когда-то раньше в этой сессии»; см.
    // auth/step-up.ts — получить step-up ticket вообще невозможно без
    // хотя бы одного настроенного у actor'а фактора. Только на реальную
    // эскалацию (новая роль ещё не была этой), не на переподтверждение
    // уже privileged-роли лишний раз.
    const isEscalation = isMfaMandatoryForRole(role) && role !== beforeRole;
    if (isEscalation && !(await assertStepUp(request, reply))) return;

    const orgId = resolveViewOrgId(request.user!, b.org_id);

    // 19.23.0 (Audit Trail): смена роли + пересборка supervisor_sectors +
    // запись в audit_log — одна транзакция. Раньше это были три независимых
    // отдельных запроса — упасть между ними означало роль сменилась, а
    // сектор остался старым (или наоборот), без какого-либо следа в логах.
    const row = await withTransaction(async (q) => {
      const res = await employeesRepo.updateRole(Number(id), role, q);
      if (role === 'supervisor' && b.sector_id) {
        await supervisorSectorsRepo.replaceForSupervisor(Number(id), b.sector_id, q);
      }
      await recordAudit({
        orgId,
        actorEmployeeId: request.user!.employee_id,
        actorTelegramId: request.user!.telegram_id ? Number(request.user!.telegram_id) : null,
        action: 'employee.role_change',
        targetType: 'employee',
        targetId: id,
        before: { role: beforeRole ?? null },
        after: { role },
        requestId: request.id,
        actorRole: request.user!.role
      }, q);
      return res;
    });

    // §14/15/ROLE-1 (20.52.1) — эскалация в privileged-роль отзывает ВСЕ
    // активные сессии сотрудника: без этого уже открытая (AAL1, до
    // назначения роли) browser-сессия молча унаследовала бы admin/
    // supervisor-доступ на следующий же запрос (role читается заново из
    // БД на каждый запрос, principal.ts::loadUser), не пройдя MFA вообще.
    // Вне транзакции, best-effort, тем же принципом, что invalidateScope
    // ниже — это защитная мера поверх уже закоммиченной смены роли, не
    // часть её целостности.
    if (isEscalation) {
      await sessionsRepo.deleteAllForEmployee(Number(id)).catch((e: any) =>
        console.error('revoke sessions on role escalation:', e?.message || e)
      );
      // 20.53.0 — тот же принцип для Telegram AAL2-грантов (см.
      // org/access.ts's approve-путь для полного объяснения сценария).
      await mfaRepo.revokeAllTelegramGrants(Number(id)).catch((e: any) =>
        console.error('revoke telegram grants on role escalation:', e?.message || e)
      );
    }

    // Инвалидация вне транзакции намеренно — кэш только про производительность
    // чтения, не про целостность данных (в отличие от withTransaction выше);
    // если после успешного коммита процесс упадёт ровно тут, худший случай —
    // кэш доживёт до TTL (5 мин), не бесконечно устаревшие данные.
    invalidateScope(Number(id));

    return row;
    }
  );
}
