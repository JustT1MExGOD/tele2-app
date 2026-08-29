/**
 * Не-Telegram вход (телефон + пароль, 20.35, план) — второй identity
 * provider поверх шва 20.9.0 (docs/ADR/005-authentication-boundary.md).
 * Telegram-путь (org/access.ts, providers/telegram.ts) не тронут — этот
 * файл только добавляет параллельный вход, не заменяет существующий.
 *
 * Регистрация — открытая, самостоятельная (телефон+пароль+имя), тот же
 * flow "заявка → админ одобряет", что уже есть для Telegram: пишет в тот
 * же access_requests (provider='phone'), approve — в org/access.ts.
 * Сброс пароля — через админа (POST /auth/admin/reset-password/:id), нет
 * SMS-провайдера для self-service — решение владельца продукта.
 */
import { createHash } from 'crypto';
import { FastifyInstance, FastifyReply } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import {
  requireManager,
  requireEmployeeInOrg,
  resolveViewOrgId
} from '../../../auth/guards.js';
import { hashPassword, verifyPassword } from '../../../auth/password.js';
import { COOKIE_NAME } from '../../../auth/providers/phone.js';
import { CSRF_COOKIE_NAME, setCsrfCookie } from '../../../auth/csrf.js';
import { normalizePhone } from '../../../utils/phone.js';
import { withTransaction } from '../../../data/db/index.js';
import { bot } from '../../../integrations/telegram/bot.js';
import * as employeesRepo from '../../../data/repositories/employees.js';
import * as identitiesRepo from '../../../data/repositories/identities.js';
import * as accessRequestsRepo from '../../../data/repositories/access-requests.js';
import * as sessionsRepo from '../../../data/repositories/sessions.js';
import * as mfaRepo from '../../../data/repositories/mfa.js';
import { hasConfirmedMfaFactor } from '../../../auth/mfa/index.js';
import { isTotpConfirmed } from '../../../auth/mfa/totp.js';
import { assertStepUp } from '../../../auth/step-up.js';
import type {
  RegisterPhoneRequest,
  RegisterPhoneResponse,
  LoginRequest,
  LoginResponse,
  LogoutResponse,
  AdminResetPasswordResponse,
  ConsumeResetRequest,
  ConsumeResetResponse
} from '../../../shared/api-types.js';

const RegisterBody = Type.Object({
  phone: Type.String({ minLength: 7, maxLength: 16 }),
  password: Type.String({ minLength: 8, maxLength: 200 }),
  full_name: Type.String({ minLength: 1 }),
  claimed_employee_id: Type.Optional(Type.Union([Type.Null(), Type.Number()])),
  org_id: Type.Optional(Type.String()),
  message: Type.Optional(Type.String())
});
type RegisterBody = Static<typeof RegisterBody>;

const LoginBody = Type.Object({
  phone: Type.String({ minLength: 7, maxLength: 16 }),
  password: Type.String({ minLength: 1, maxLength: 200 })
});
type LoginBody = Static<typeof LoginBody>;

const ResetBody = Type.Object({
  password: Type.String({ minLength: 8, maxLength: 200 })
});
type ResetBody = Static<typeof ResetBody>;

function esc(s: any) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const isProd = () => process.env.RAILWAY_ENVIRONMENT === 'production';

/**
 * 20.48.0 — t2_csrf ставится/ротируется ВМЕСТЕ с t2_session на каждый
 * новый логин (double-submit cookie, см. auth/csrf.ts::setCsrfCookie).
 */
export function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60
  });
  setCsrfCookie(reply);
}

export async function registerSessionRoutes(app: FastifyInstance) {
  // Регистрация — публично, жёсткий rate-limit (единственная открытая
  // точка входа для не-Telegram провайдера, ту же дисциплину, что
  // /access/request, но строже — там уже есть подтверждённая Telegram identity).
  app.post(
    '/auth/register',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { body: RegisterBody } },
    async (request, reply): Promise<RegisterPhoneResponse | FastifyReply | undefined> => {
      const b = request.body as RegisterBody;
      const phone = normalizePhone(String(b.phone || ''));
      const full_name = String(b.full_name || '').trim();
      if (!phone) {
        return reply.code(400).send({ error: 'invalid_phone', message: 'Некорректный номер телефона' });
      }
      if (!full_name || full_name.length < 3) {
        return reply.code(400).send({ error: 'full_name required' });
      }

      // 20.48.0 — identities, не employeesRepo.findByPhone напрямую:
      // единый resolution layer для phone, симметрично Telegram.
      const existingEmployeeId = await identitiesRepo.findEmployeeId('phone', phone);
      if (existingEmployeeId) {
        return reply.code(409).send({ error: 'phone_taken', message: 'Этот номер уже зарегистрирован' });
      }

      const pending = await accessRequestsRepo.findPendingByPhone(phone);
      if (pending) {
        return { ok: true, status: 'pending', id: pending.id };
      }

      const claimedId = b.claimed_employee_id ? Number(b.claimed_employee_id) : null;
      let effectiveOrgId = String(b.org_id || 'default');
      if (claimedId) {
        const claimedOrgId = await employeesRepo.getOrgId(claimedId);
        effectiveOrgId = claimedOrgId || 'default';
      }
      const storedOrgId = claimedId ? null : (b.org_id ? String(b.org_id) : null);

      const passwordHash = await hashPassword(b.password);
      const created = await accessRequestsRepo.createPhone({
        phone,
        passwordHash,
        fullName: full_name,
        claimedEmployeeId: claimedId,
        message: b.message || '',
        orgId: storedOrgId
      });

      try {
        const managers = await employeesRepo.findManagersToNotify(effectiveOrgId);
        const text =
          `🔐 <b>Заявка на доступ (веб)</b>\n` +
          `👤 ${esc(full_name)}\n` +
          `Телефон: <code>${esc(phone)}</code>\n` +
          (b.message ? `💬 ${esc(b.message)}\n` : '') +
          `\nПодтверди в Mini App → Команда → Заявки`;
        for (const m of managers) {
          if (bot && m.telegram_id) {
            await bot.api.sendMessage(m.telegram_id, text, { parse_mode: 'HTML' }).catch(() => {});
          }
        }
      } catch (e) {
        console.error('notify managers (phone)', e);
      }

      // password_hash никогда не должен уйти клиенту, даже хешированный —
      // createPhone() возвращает RETURNING * (нужен server-side, для уведомления
      // выше не нужен), здесь явно вырезаем перед ответом.
      const { password_hash: _hash, ...safeRequest } = created;
      return { ok: true, status: 'pending', request: safeRequest };
    }
  );

  app.post(
    '/auth/login',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          // 20.48.0 — ключуем по нормализованному+хэшированному телефону,
          // не по IP: закрывает distributed brute-force по одному номеру
          // через много IP (raw-номер не течёт в rate-limit internals как
          // PII). Работает ВМЕСТЕ с уже существующим глобальным per-IP
          // лимитом (app.ts, 300/min), не вместо него.
          keyGenerator: (req: any) => {
            const raw = req.body?.phone;
            const norm = raw ? normalizePhone(String(raw)) : null;
            return norm ? `login:${createHash('sha256').update(norm).digest('hex')}` : req.ip;
          }
        }
      },
      schema: { body: LoginBody }
    },
    async (request, reply): Promise<LoginResponse | FastifyReply> => {
      const b = request.body as LoginBody;
      const phone = normalizePhone(String(b.phone || ''));

      // 20.48.0 — identities, не employeesRepo.findByPhone напрямую.
      const employeeId = phone ? await identitiesRepo.findEmployeeId('phone', phone) : null;
      const e = employeeId ? await employeesRepo.findByIdWithPassword(employeeId) : null;
      // Одинаковый 401 для "нет такого телефона" и "неверный пароль" —
      // иначе ответ сам подтверждает/опровергает, что номер зарегистрирован.
      if (!e || !e.password_hash || !(await verifyPassword(b.password, e.password_hash))) {
        return reply.code(401).send({ error: 'invalid_credentials', message: 'Неверный телефон или пароль' });
      }
      if (e.is_active === false || e.access_status !== 'active') {
        return reply.code(403).send({ error: 'not_active', message: 'Доступ ещё не подтверждён' });
      }

      // 20.52.0 (MFA) — если у сотрудника есть подтверждённый второй
      // фактор, пароль сам по себе больше не выдаёт рабочую сессию:
      // возвращаем mfa_token (короткоживущий, single-use), реальная
      // cookie-сессия появляется только после POST /auth/mfa/login.
      // Роль здесь ни при чём — это свойство КОНКРЕТНОГО аккаунта (есть
      // ли у него включённый фактор), не глобальная политика по роли
      // (см. docs/ADR/010-mfa.md — mandatory для admin/supervisor
      // обеспечивается тем, что все опасные действия требуют step-up,
      // а step-up физически недостижим без хотя бы одного фактора).
      if (await hasConfirmedMfaFactor(e.id)) {
        const mfaToken = await mfaRepo.createPendingLogin(e.id);
        const methods: ('totp' | 'webauthn' | 'recovery_code')[] = [];
        const creds = await mfaRepo.listActiveWebAuthnCredentials(e.id);
        if (creds.length) methods.push('webauthn');
        if (await isTotpConfirmed(e.id)) methods.push('totp');
        const remaining = await mfaRepo.countActiveRecoveryCodes(e.id);
        if (remaining > 0) methods.push('recovery_code');
        return { ok: true, mfa_required: true, mfa_token: mfaToken, mfa_methods: methods };
      }

      const token = await sessionsRepo.createSession(e.id, false, e.role);
      setSessionCookie(reply, token);
      return { ok: true };
    }
  );

  app.post('/auth/logout', async (request, reply): Promise<LogoutResponse> => {
    const token = request.cookies?.[COOKIE_NAME];
    if (token) await sessionsRepo.deleteSession(token);
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    reply.clearCookie(CSRF_COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  // Сброс — сам токен в URL уже секрет (32 случайных байта), доступ без
  // авторизации намеренный: пользователь ещё не залогинен, это и есть цель.
  app.post(
    '/auth/reset/:token',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { body: ResetBody } },
    async (request, reply): Promise<ConsumeResetResponse | FastifyReply> => {
      const { token } = request.params as { token: string };
      const b = request.body as ResetBody;

      const reset = await sessionsRepo.resolvePasswordReset(token);
      if (!reset) {
        return reply.code(400).send({ error: 'invalid_token', message: 'Ссылка недействительна или уже использована' });
      }

      const passwordHash = await hashPassword(b.password);
      await employeesRepo.setPasswordHash(reset.employee_id, passwordHash);
      await sessionsRepo.consumePasswordReset(reset.id);
      // 20.48.0 — смена пароля инвалидирует все активные browser-сессии
      // (устройство A украдено → пароль меняют на B → A не остаётся рабочим).
      await sessionsRepo.deleteAllForEmployee(reset.employee_id);

      const role = await employeesRepo.getRole(reset.employee_id);
      const sessionToken = await sessionsRepo.createSession(reset.employee_id, false, role);
      setSessionCookie(reply, sessionToken);
      return { ok: true };
    }
  );

  // Admin-сброс — org-scope проверен тем же декоратором, что PATCH/DELETE
  // /employees/:id (requireEmployeeInOrg), только manager+.
  app.post(
    '/auth/admin/reset-password/:employeeId',
    { preHandler: [requireEmployeeInOrg('params', 'employeeId', { allowOrgOverride: true })] },
    async (request, reply): Promise<AdminResetPasswordResponse | FastifyReply | undefined> => {
      if (!requireManager(request, reply)) return;
      // Step-up (20.52.0) — сброс чужого пароля даёт полный доступ к
      // аккаунту через первый же вход — та же категория риска, что выдача
      // роли admin, поэтому тот же свежий MFA-барьер перед действием.
      if (!(await assertStepUp(request, reply))) return;
      const { employeeId } = request.params as { employeeId: string };
      const { org_id } = (request.query || {}) as { org_id?: string };
      resolveViewOrgId(request.user!, org_id);

      const token = await sessionsRepo.createPasswordReset(Number(employeeId), request.user!.employee_id);
      const resetUrl = `/?reset=${token}`;
      return { ok: true, reset_url: resetUrl };
    }
  );
}
