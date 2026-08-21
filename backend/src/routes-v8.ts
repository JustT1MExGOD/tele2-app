/**
 * T2 Sales v8 — Access control + Supervisor cabinet
 *
 * await registerV8Routes(app);
 *
 * Важно: на «боевых» роутах (sales write, etc.) вызывай requireActive.
 * Публичные: /health, /ready, /access/status, /access/request, /access/orgs,
 * /access/employees-directory, /combo/calc
 */

import { FastifyInstance } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { query, withTransaction } from './db/index.js';
import {
  requireActive,
  requireManager,
  requireManagerOrSupervisor,
  getUserStoreIds,
  loadUser,
  authPlugin,
  canAssignRole,
  resolveViewOrgId,
  requireEmployeeInOrg,
  Role
} from './middleware-auth.js';
import { todayMoscow } from './utils/date.js';
import { bot } from './bot/index.js';
import { listActiveOrgsPublic } from './services/tenant.js';
import { recordAudit } from './services/audit.js';

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

const EmployeeRoleBody = Type.Object({
  role: Type.String({ minLength: 1 }),
  org_id: Type.Optional(Type.String()),
  sector_id: Type.Optional(Type.String())
});
type EmployeeRoleBody = Static<typeof EmployeeRoleBody>;

function esc(s: any) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function registerV8Routes(app: FastifyInstance) {
  // подтянуть user на каждый запрос
  // ===== ACCESS STATUS (гость может) =====
  app.get('/access/status', async (request) => {
    // request.user уже проставлен глобальным authPlugin и подтверждён
    // подписью Telegram initData (или явным ALLOW_INSECURE_AUTH в деве) —
    // раньше при отсутствующем request.user роут тихо доверял голому
    // X-Telegram-Id заголовку напрямую (loadUser(Number(raw))), сводя на
    // нет всю проверку подписи даже в "боевом" режиме.
    if (!request.user?.telegram_id) return { status: 'anonymous' };
    const user = request.user;

    // pending request without employee row?
    if (user.access_status === 'none') {
      const req = await query(
        `SELECT * FROM access_requests
         WHERE telegram_id = $1
         ORDER BY created_at DESC LIMIT 1`,
        [user.telegram_id]
      );
      if (req.rows[0]) {
        return {
          status: req.rows[0].status,
          request: req.rows[0],
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
  app.get('/access/orgs', async () => {
    return listActiveOrgsPublic();
  });

  // Список сотрудников для «я вот этот» (только имена, без чувствительного).
  // ?org_id= — сузить до сети, которую гость уже выбрал в пикере, иначе
  // выбрав сеть B он всё равно мог «заклеймить» сотрудника сети A.
  app.get('/access/employees-directory', async (request) => {
    const { org_id } = request.query as { org_id?: string };
    const params: any[] = [];
    let orgFilter = '';
    if (org_id) {
      params.push(String(org_id));
      orgFilter = ` AND COALESCE(org_id,'default') = $${params.length}`;
    }
    const res = await query(
      `SELECT id, full_name FROM employees
       WHERE is_active = true AND (telegram_id IS NULL OR telegram_id = 0)
         AND (access_status = 'active' OR access_status IS NULL)${orgFilter}
       ORDER BY full_name`,
      params
    );
    return res.rows;
  });

  // Заявка на доступ
  app.post(
    '/access/request',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { body: AccessRequestBody } },
    async (request, reply) => {
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
    const existing = await loadUser(telegramId);
    if (existing.access_status === 'active') {
      return { ok: true, status: 'active', message: 'Уже есть доступ' };
    }

    const pending = await query(
      `SELECT id FROM access_requests WHERE telegram_id = $1 AND status = 'pending'`,
      [telegramId]
    );
    if (pending.rows[0]) {
      return { ok: true, status: 'pending', id: pending.rows[0].id };
    }

    const claimedId = b.claimed_employee_id ? Number(b.claimed_employee_id) : null;

    // Сеть для роутинга уведомления: если claim — сеть заклеймленного
    // сотрудника (единый источник правды); иначе то, что гость выбрал в
    // пикере (пикер эпика 16.0), с фолбэком на 'default' как везде в коде.
    let effectiveOrgId = String(b.org_id || 'default');
    if (claimedId) {
      const claimed = await query(`SELECT COALESCE(org_id,'default') as org_id FROM employees WHERE id = $1`, [claimedId]);
      effectiveOrgId = claimed.rows[0]?.org_id || 'default';
    }
    // org_id на самой заявке: NULL для claim-пути (не дублируем сеть
    // сотрудника — источники могут разойтись), иначе то, что выбрал гость.
    const storedOrgId = claimedId ? null : (b.org_id ? String(b.org_id) : null);

    const res = await query(
      `INSERT INTO access_requests
         (telegram_id, telegram_username, full_name, claimed_employee_id, message, status, org_id)
       VALUES ($1,$2,$3,$4,$5,'pending',$6)
       RETURNING *`,
      [
        telegramId,
        b.username || null,
        full_name,
        claimedId,
        b.message || '',
        storedOrgId
      ]
    );

    // уведомить managers своей сети + admin (страховка, если у новой сети
    // ещё нет активного управляющего)
    try {
      const managers = await query(
        `SELECT telegram_id, full_name FROM employees
         WHERE telegram_id IS NOT NULL AND access_status = 'active'
           AND ( role = 'admin'
                 OR (role IN ('manager','supervisor','senior') AND COALESCE(org_id,'default') = $1) )`,
        [effectiveOrgId]
      );
      const text =
        `🔐 <b>Заявка на доступ</b>\n` +
        `👤 ${esc(full_name)}\n` +
        `TG: <code>${telegramId}</code>\n` +
        (b.message ? `💬 ${esc(b.message)}\n` : '') +
        `\nПодтверди в Mini App → Команда → Заявки`;
      for (const m of managers.rows) {
        if (bot && m.telegram_id) {
          await bot.api.sendMessage(m.telegram_id, text, { parse_mode: 'HTML' }).catch(() => {});
        }
      }
    } catch (e) {
      console.error('notify managers', e);
    }

    return { ok: true, status: 'pending', request: res.rows[0] };
    }
  );

  // Очередь заявок — manager + supervisor. Приоритет сети: прямой org_id на
  // заявке (эпик 16.0, гость выбрал сеть в пикере при регистрации) → сеть
  // заклеймленного сотрудника (claim-путь) → 'default' (только хвосты до
  // миграции access-requests-org.sql, уже закрыты backfill'ом там же).
  app.get('/access/requests', async (request, reply) => {
    if (!requireManagerOrSupervisor(request, reply)) return;
    const { org_id } = request.query as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, org_id);
    const res = await query(
      `SELECT ar.* FROM access_requests ar
       LEFT JOIN employees e ON e.id = ar.claimed_employee_id
       WHERE ar.status = 'pending'
         AND COALESCE(ar.org_id, COALESCE(e.org_id,'default'), 'default') = $1
       ORDER BY ar.created_at ASC`,
      [orgId]
    );
    return res.rows;
  });

  // Approve
  app.post(
    '/access/requests/:id/approve',
    { schema: { body: AccessApproveBody } },
    async (request, reply) => {
    if (!requireManagerOrSupervisor(request, reply)) return;
    const { id } = request.params as { id: string };
    const b = (request.body as AccessApproveBody) || {};
    const ALL_ROLES: Role[] = ['trainee', 'employee', 'senior', 'manager', 'supervisor', 'admin'];
    const requestedRole: Role = ALL_ROLES.includes(b.role as Role) ? (b.role as Role) : 'employee';
    // Каскад: одобряющий может выдать только роль строго ниже своей (admin — без ограничений).
    const role: Role = canAssignRole(request.user!.role, requestedRole) ? requestedRole : 'employee';

    const reqRes = await query(
      `SELECT ar.*, COALESCE(ar.org_id, e.org_id, 'default') as effective_org_id
       FROM access_requests ar
       LEFT JOIN employees e ON e.id = ar.claimed_employee_id
       WHERE ar.id = $1`,
      [Number(id)]
    );
    const req = reqRes.rows[0];
    if (!req || req.status !== 'pending') {
      return reply.code(404).send({ error: 'request not found' });
    }
    // Список заявок (GET /access/requests) уже фильтруется по этому же
    // условию — но сам approve/reject это раньше не перепроверял: manager
    // одной сети, зная/угадав id заявки другой сети, мог одобрить/отклонить
    // её напрямую через API, в обход списка.
    const orgId = resolveViewOrgId(request.user!, b.org_id);
    if (req.effective_org_id !== orgId) {
      return reply.code(403).send({ error: 'forbidden', message: 'Заявка не принадлежит вашей сети' });
    }

    let employeeId = req.claimed_employee_id ? Number(req.claimed_employee_id) : null;

    if (employeeId) {
      await query(
        `UPDATE employees SET
           telegram_id = $1,
           access_status = 'active',
           role = COALESCE($2, role),
           verified_by = $3,
           verified_at = now(),
           full_name = COALESCE(full_name, $4)
         WHERE id = $5`,
        [req.telegram_id, role === 'employee' ? null : role, request.user!.employee_id, req.full_name, employeeId]
      );
    } else {
      // Создать нового — попадает в сеть заявки (гость выбрал в пикере при
      // регистрации), а не в сеть одобряющего. Важно с тех пор, как admin
      // получает cc по заявкам любой сети (эпик 16.0) — иначе admin,
      // одобряя чужую заявку из своей сессии, молча создал бы сотрудника
      // в СВОЕЙ сети. Фолбэк на сеть одобряющего только если у заявки
      // вообще нет org_id (не должно происходить после миграции, кроме
      // как для уже неактуальных пред-миграционных строк).
      const orgId = req.org_id || request.user!.org_id;
      const ins = await query(
        `INSERT INTO employees (full_name, telegram_id, role, access_status, is_active, verified_by, verified_at, org_id)
         VALUES ($1,$2,$3,'active',true,$4,now(),$5)
         RETURNING id`,
        [req.full_name, req.telegram_id, role, request.user!.employee_id, orgId]
      );
      // если нет serial — может понадобиться ручной id; предполагаем serial/identity
      employeeId = ins.rows[0]?.id;
    }

    await query(
      `UPDATE access_requests
       SET status = 'approved', reviewed_by = $1, reviewed_at = now()
       WHERE id = $2`,
      [request.user!.employee_id, Number(id)]
    );

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
    const reqRes = await query(
      `SELECT ar.*, COALESCE(ar.org_id, e.org_id, 'default') as effective_org_id
       FROM access_requests ar
       LEFT JOIN employees e ON e.id = ar.claimed_employee_id
       WHERE ar.id = $1`,
      [Number(id)]
    );
    const req = reqRes.rows[0];
    if (!req) return reply.code(404).send({ error: 'not found' });
    const orgId = resolveViewOrgId(request.user!, (request.body as AccessRejectBody)?.org_id);
    if (req.effective_org_id !== orgId) {
      return reply.code(403).send({ error: 'forbidden', message: 'Заявка не принадлежит вашей сети' });
    }

    await query(
      `UPDATE access_requests
       SET status = 'rejected', reviewed_by = $1, reviewed_at = now()
       WHERE id = $2`,
      [request.user!.employee_id, Number(id)]
    );

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
      const all = await query(
        `SELECT id, COALESCE(display_name, name) as name, code, color, plan_share FROM stores s
         WHERE is_active = true OR is_active IS NULL ORDER BY s.name`
      );
      return all.rows;
    }
    const res = await query(
      `SELECT st.id, COALESCE(st.display_name, st.name) as name, st.code, st.color, st.plan_share
       FROM supervisor_sectors ss
       JOIN organizations o ON o.sector_id = ss.sector_id
       JOIN stores st ON COALESCE(st.org_id, 'default') = o.id
       WHERE ss.supervisor_id = $1
       ORDER BY st.name`,
      [user.employee_id]
    );
    return res.rows;
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
    await query(`DELETE FROM supervisor_sectors WHERE supervisor_id = $1`, [Number(id)]);
    await query(
      `INSERT INTO supervisor_sectors (supervisor_id, sector_id) VALUES ($1,$2)
       ON CONFLICT DO NOTHING`,
      [Number(id), sector_id]
    );
    return { ok: true, sector_id };
    }
  );

  // Назначить роль (+ сектор, если роль — supervisor)
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

    const before = await query(`SELECT role FROM employees WHERE id = $1`, [Number(id)]);
    const orgId = resolveViewOrgId(request.user!, b.org_id);

    // 19.23.0 (Audit Trail): смена роли + пересборка supervisor_sectors +
    // запись в audit_log — одна транзакция. Раньше это были три независимых
    // pool.query() — упасть между ними означало роль сменилась, а сектор
    // остался старым (или наоборот), без какого-либо следа в логах.
    const row = await withTransaction(async (q) => {
      const res = await q(
        `UPDATE employees SET role = $1 WHERE id = $2 RETURNING id, full_name, role`,
        [role, Number(id)]
      );
      if (role === 'supervisor' && b.sector_id) {
        await q(`DELETE FROM supervisor_sectors WHERE supervisor_id = $1`, [Number(id)]);
        await q(
          `INSERT INTO supervisor_sectors (supervisor_id, sector_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [Number(id), b.sector_id]
        );
      }
      await recordAudit(q, {
        orgId,
        actorEmployeeId: request.user!.employee_id,
        actorTelegramId: request.user!.telegram_id ? Number(request.user!.telegram_id) : null,
        action: 'employee.role_change',
        targetType: 'employee',
        targetId: id,
        before: { role: before.rows[0]?.role ?? null },
        after: { role },
        requestId: request.id
      });
      return res.rows[0];
    });

    return row;
    }
  );

  // /supervisor/dashboard → routes-supervisor.ts (premium analytics)

  // Удобный /me с access
  app.get('/me/access', async (request, reply) => {
    if (!request.user?.telegram_id) return reply.code(401).send({ error: 'no telegram id' });
    return request.user;
  });
}

/** Хелпер: обернуть запись продаж */
export function guardWrite(request: any, reply: any) {
  return requireActive(request, reply);
}
