/**
 * Заявки на доступ + назначение сектора супервайзеру.
 *
 * Выделено из routes-v8.ts (20.11.0, репо-реструктуризация) — эта часть
 * файла касалась только доступа/сектора; CRUD ролей сотрудника уехал в
 * org/employees.ts, /me/access — в me/index.ts (см. app.ts).
 *
 * Публичные: /access/status, /access/orgs, /access/employees-directory,
 * /access/request.
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import {
  requireManager,
  requireManagerOrSupervisor,
  loadUser,
  resolveViewOrgId,
  canAssignRole,
  type Role
} from '../../../auth/guards.js';
import { bot } from '../../../integrations/telegram/bot.js';
import { withTransaction } from '../../../data/db/index.js';
import { listActiveOrgsPublic } from '../../../core/shared/tenant.js';
import * as employeesRepo from '../../../data/repositories/employees.js';
import * as accessRequestsRepo from '../../../data/repositories/access-requests.js';
import * as supervisorSectorsRepo from '../../../data/repositories/supervisor-sectors.js';
import * as storesRepo from '../../../data/repositories/stores.js';
import { invalidate as invalidateScope } from '../../../core/shared/scope-cache.js';
import type {
  AccessStatusResponse,
  AccessOrgsResponse,
  AccessDirectoryResponse,
  SubmitAccessRequestResponse,
  AccessRequestsListResponse,
  ApproveAccessResponse
} from '../../../shared/api-types.js';

const AccessRequestBody = Type.Object({
  full_name: Type.String({ minLength: 1 }),
  // Фронт (08-access-supervisor.js) шлёт claimed_employee_id как null, когда
  // гость не выбрал существующую карточку — обработчик уже трактует это
  // через truthy-check (0 тоже "нет claim"), так что null→0 (ajv coerceTypes)
  // здесь не ломает поведение, но Null в Union — честнее и на будущее не
  // зависит от того, что 0 никогда не будет валидным employee_id.
  claimed_employee_id: Type.Optional(Type.Union([Type.Null(), Type.Number()])),
  org_id: Type.Optional(Type.String()),
  username: Type.Optional(Type.String()),
  message: Type.Optional(Type.String())
});
type AccessRequestBody = Static<typeof AccessRequestBody>;

const AccessApproveBody = Type.Object({
  role: Type.Optional(Type.String()),
  org_id: Type.Optional(Type.String())
});
type AccessApproveBody = Static<typeof AccessApproveBody>;

const AccessRejectBody = Type.Object({
  org_id: Type.Optional(Type.String())
});
type AccessRejectBody = Static<typeof AccessRejectBody>;

const SupervisorSectorBody = Type.Object({
  sector_id: Type.String({ minLength: 1 })
});
type SupervisorSectorBody = Static<typeof SupervisorSectorBody>;

function esc(s: any) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function registerAccessRoutes(app: FastifyInstance) {
  // ===== ACCESS STATUS (гость может) =====
  app.get('/access/status', async (request): Promise<AccessStatusResponse> => {
    // request.user уже проставлен глобальным authPlugin и подтверждён
    // подписью Telegram initData (или явным ALLOW_INSECURE_AUTH в деве) —
    // раньше при отсутствующем request.user роут тихо доверял голому
    // X-Telegram-Id заголовку напрямую (loadUser(Number(raw))), сводя на
    // нет всю проверку подписи даже в "боевом" режиме.
    if (!request.user?.telegram_id) return { status: 'anonymous' };
    const user = request.user;

    // pending request without employee row?
    if (user.access_status === 'none') {
      const req = await accessRequestsRepo.findLatestByTelegramId(user.telegram_id);
      if (req) {
        return {
          status: req.status,
          request: req,
          user
        };
      }
    }
    return {
      status: user.access_status === 'none' ? 'none' : user.access_status,
      user
    };
  });

  // Активные сети — пикер при регистрации. Публично: гость ещё не
  // авторизован, id+имя(+бренд для темизации) — ничего чувствительного
  // (нет chat_id, нет sector_id).
  app.get('/access/orgs', async (): Promise<AccessOrgsResponse> => {
    return listActiveOrgsPublic();
  });

  // Список сотрудников для «я вот этот» (только имена, без чувствительного).
  // ?org_id= — сузить до сети, которую гость уже выбрал в пикере, иначе
  // выбрав сеть B он всё равно мог «заклеймить» сотрудника сети A.
  app.get('/access/employees-directory', async (request): Promise<AccessDirectoryResponse> => {
    const { org_id } = request.query as { org_id?: string };
    return employeesRepo.findUnclaimedDirectory(org_id ? String(org_id) : undefined);
  });

  // Заявка на доступ
  app.post(
    '/access/request',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { body: AccessRequestBody } },
    async (request, reply): Promise<SubmitAccessRequestResponse | FastifyReply | undefined> => {
    // Та же поправка, что /me/bind — telegram_id только из подтверждённого
    // request.user, не из спуфабельного заголовка напрямую.
    const telegramId = Number(request.user?.telegram_id || 0);
    if (!telegramId) return reply.code(401).send({ error: 'unauthorized', message: 'Telegram initData не подтверждён' });
    const b = request.body as AccessRequestBody;
    const full_name = String(b.full_name || '').trim();
    if (!full_name || full_name.length < 3) {
      return reply.code(400).send({ error: 'full_name required' });
    }

    // уже active?
    const existing = await loadUser({ provider: 'telegram', providerId: String(telegramId) });
    if (existing.access_status === 'active') {
      return { ok: true, status: 'active', message: 'Уже есть доступ' };
    }

    const pending = await accessRequestsRepo.findPendingByTelegramId(telegramId);
    if (pending) {
      return { ok: true, status: 'pending', id: pending.id };
    }

    const claimedId = b.claimed_employee_id ? Number(b.claimed_employee_id) : null;

    // Сеть для роутинга уведомления: если claim — сеть заклеймленного
    // сотрудника (единый источник правды); иначе то, что гость выбрал в
    // пикере (пикер эпика 16.0), с фолбэком на 'default' как везде в коде.
    let effectiveOrgId = String(b.org_id || 'default');
    if (claimedId) {
      const claimedOrgId = await employeesRepo.getOrgId(claimedId);
      effectiveOrgId = claimedOrgId || 'default';
    }
    // org_id на самой заявке: NULL для claim-пути (не дублируем сеть
    // сотрудника — источники могут разойтись), иначе то, что выбрал гость.
    const storedOrgId = claimedId ? null : (b.org_id ? String(b.org_id) : null);

    const created = await accessRequestsRepo.create({
      telegramId,
      username: b.username || null,
      fullName: full_name,
      claimedEmployeeId: claimedId,
      message: b.message || '',
      orgId: storedOrgId
    });

    // уведомить managers своей сети + admin (страховка, если у новой сети
    // ещё нет активного управляющего)
    try {
      const managers = await employeesRepo.findManagersToNotify(effectiveOrgId);
      const text =
        `🔐 <b>Заявка на доступ</b>\n` +
        `👤 ${esc(full_name)}\n` +
        `TG: <code>${telegramId}</code>\n` +
        (b.message ? `💬 ${esc(b.message)}\n` : '') +
        `\nПодтверди в Mini App → Команда → Заявки`;
      for (const m of managers) {
        if (bot && m.telegram_id) {
          await bot.api.sendMessage(m.telegram_id, text, { parse_mode: 'HTML' }).catch(() => {});
        }
      }
    } catch (e) {
      console.error('notify managers', e);
    }

    return { ok: true, status: 'pending', request: created };
    }
  );

  // Очередь заявок — manager + supervisor. Приоритет сети: прямой org_id на
  // заявке (эпик 16.0, гость выбрал сеть в пикере при регистрации) → сеть
  // заклеймленного сотрудника (claim-путь) → 'default' (только хвосты до
  // миграции access-requests-org.sql, уже закрыты backfill'ом там же).
  app.get('/access/requests', async (request, reply): Promise<AccessRequestsListResponse | undefined> => {
    if (!requireManagerOrSupervisor(request, reply)) return;
    const { org_id } = request.query as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, org_id);
    return accessRequestsRepo.listPendingForOrg(orgId);
  });

  // Approve
  app.post(
    '/access/requests/:id/approve',
    { schema: { body: AccessApproveBody } },
    async (request, reply): Promise<ApproveAccessResponse | FastifyReply | undefined> => {
    if (!requireManagerOrSupervisor(request, reply)) return;
    const { id } = request.params as { id: string };
    const b = (request.body as AccessApproveBody) || {};
    const ALL_ROLES: Role[] = ['trainee', 'employee', 'senior', 'manager', 'supervisor', 'admin'];
    const requestedRole: Role = ALL_ROLES.includes(b.role as Role) ? (b.role as Role) : 'employee';
    // Каскад: одобряющий может выдать только роль строго ниже своей (admin — без ограничений).
    const role: Role = canAssignRole(request.user!.role, requestedRole) ? requestedRole : 'employee';

    const req = await accessRequestsRepo.findByIdWithEffectiveOrg(Number(id));
    if (!req) {
      return reply.code(404).send({ error: 'request not found' });
    }
    // Список заявок (GET /access/requests) уже фильтруется по этому же
    // условию — но сам approve/reject это раньше не перепроверял: manager
    // одной сети, зная/угадав id заявки другой сети, мог одобрить/отклонить
    // её напрямую через API, в обход списка. Проверяется независимо от
    // status — не хотим подтверждать существование/детали чужой заявки
    // даже если её уже кто-то обработал.
    const orgId = resolveViewOrgId(request.user!, b.org_id);
    if (req.effective_org_id !== orgId) {
      return reply.code(403).send({ error: 'forbidden', message: 'Заявка не принадлежит вашей сети' });
    }

    // 20.15.0: раньше "уже не pending" проверялось ЗДЕСЬ, до транзакции —
    // это читало status нативно (не CAS), поэтому при двух одновременных
    // approve тот, что дошёл до этой строки чуть позже, чем первый успел
    // закоммититься, получал голый 404 вместо аккуратного deduped-ответа.
    // Теперь единственный источник "уже обработано" — сам CAS ниже, что
    // даёт одинаково опрятный ответ и при гонке, и при повторном ретрае
    // после того как первый запрос уже реально завершился.
    //
    // CAS: markApproved первым делом в транзакции — если заявку уже успел
    // обработать параллельный запрос (двойной тап/ретрай на медленной
    // сети), UPDATE затронет 0 строк и мы не создадим второго сотрудника
    // и не пошлём второе "Доступ открыт". Если create/approveExisting
    // упадёт — транзакция откатится целиком, включая сам markApproved,
    // так что заявка вернётся в pending и останется ретраябельной, а не
    // застрянет в approved без реально созданного/обновлённого сотрудника.
    const employeeId = await withTransaction(async (q) => {
      const claimed = await accessRequestsRepo.markApproved(Number(id), request.user!.employee_id, q);
      if (!claimed) return null;

      if (req.claimed_employee_id) {
        const existingId = Number(req.claimed_employee_id);
        await employeesRepo.approveExisting(
          existingId, req.telegram_id, role === 'employee' ? null : role, request.user!.employee_id, req.full_name, q
        );
        return existingId;
      }
      // Создать нового — попадает в сеть заявки (гость выбрал в пикере при
      // регистрации), а не в сеть одобряющего. Важно с тех пор, как admin
      // получает cc по заявкам любой сети (эпик 16.0) — иначе admin,
      // одобряя чужую заявку из своей сессии, молча создал бы сотрудника
      // в СВОЕЙ сети. Фолбэк на сеть одобряющего только если у заявки
      // вообще нет org_id (не должно происходить после миграции, кроме
      // как для уже неактуальных пред-миграционных строк).
      const orgId = req.org_id || request.user!.org_id;
      return employeesRepo.createFromApproval(req.full_name, req.telegram_id, role, request.user!.employee_id, orgId, q);
    });

    if (employeeId === null) {
      return { ok: true, deduped: true, employee_id: null, role };
    }

    if (bot && req.telegram_id) {
      await bot.api
        .sendMessage(
          req.telegram_id,
          `✅ <b>Доступ открыт</b>\nДобро пожаловать в T2 Sales.\nОткрой приложение заново.`,
          { parse_mode: 'HTML' }
        )
        .catch(() => {});
    }

    return { ok: true, employee_id: employeeId, role };
    }
  );

  // Reject
  app.post(
    '/access/requests/:id/reject',
    { schema: { body: AccessRejectBody } },
    async (request, reply) => {
    if (!requireManagerOrSupervisor(request, reply)) return;
    const { id } = request.params as { id: string };
    const req = await accessRequestsRepo.findByIdWithEffectiveOrg(Number(id));
    if (!req) return reply.code(404).send({ error: 'not found' });
    const orgId = resolveViewOrgId(request.user!, (request.body as AccessRejectBody)?.org_id);
    if (req.effective_org_id !== orgId) {
      return reply.code(403).send({ error: 'forbidden', message: 'Заявка не принадлежит вашей сети' });
    }

    // CAS — тот же приём, что approve (см. комментарий там): двойной
    // тап/ретрай не должен слать второе "в доступе отказано".
    const rejected = await accessRequestsRepo.markRejected(Number(id), request.user!.employee_id);
    if (!rejected) {
      return { ok: true, deduped: true };
    }

    if (bot && req.telegram_id) {
      await bot.api
        .sendMessage(req.telegram_id, `❌ В доступе к T2 Sales отказано. Напиши своему manager.`, {
          parse_mode: 'HTML'
        })
        .catch(() => {});
    }
    return { ok: true };
    }
  );

  // ===== SUPERVISOR: точки =====
  // Супервайзер = руководитель сектора: видит все точки всех сетей своего
  // сектора целиком, назначается на сектор, а не на отдельные точки вручную.
  app.get('/supervisor/stores', async (request, reply) => {
    if (!requireManagerOrSupervisor(request, reply)) return;
    const user = request.user!;
    if (user.role === 'manager' || user.role === 'admin') {
      return storesRepo.listAllActiveForPicker();
    }
    return supervisorSectorsRepo.listStoresForSupervisor(user.employee_id!);
  });

  app.put(
    '/supervisor/:id/sector',
    { schema: { body: SupervisorSectorBody } },
    async (request, reply) => {
    // Назначение сектора — это доступ ко ВСЕМ сетям сектора разом, а не
    // одной сети. requireManager (обычный manager сети) раньше мог назначить
    // ЛЮБОГО сотрудника (любой сети, по угаданному id) супервайзером ЛЮБОГО
    // сектора — по сути раздавать межсетевые полномочия без ограничений.
    // Это прерогатива admin, как и переключатель сетей/GET /orgs.
    if (!requireManager(request, reply)) return;
    if (request.user!.role !== 'admin') {
      return reply.code(403).send({ error: 'forbidden', message: 'Назначение сектора — только admin' });
    }
    const { id } = request.params as { id: string };
    const { sector_id } = request.body as SupervisorSectorBody;
    await supervisorSectorsRepo.replaceForSupervisor(Number(id), sector_id);
    invalidateScope(Number(id));
    return { ok: true, sector_id };
    }
  );
}
