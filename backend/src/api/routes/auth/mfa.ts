/**
 * MFA (20.52.0) — TOTP/WebAuthn/recovery-codes enrollment + management,
 * login-time second-factor verification, and step-up ticket issuance.
 * See docs/ADR/010-mfa.md for the architecture (why WebAuthn-first,
 * why step-up is a channel-agnostic ticket, why enrollment is enforced
 * via step-up-gated actions rather than a blanket route interceptor).
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { requireAuth, requireActive, requireManager, requireEmployeeInOrg, resolveViewOrgId } from '../../../auth/guards.js';
import { assertStepUp, issueStepUpTicket } from '../../../auth/step-up.js';
import { hasConfirmedMfaFactor } from '../../../auth/mfa/index.js';
import * as totp from '../../../auth/mfa/totp.js';
import * as webauthn from '../../../auth/mfa/webauthn.js';
import * as recoveryCodes from '../../../auth/mfa/recovery-codes.js';
import * as mfaRepo from '../../../data/repositories/mfa.js';
import * as employeesRepo from '../../../data/repositories/employees.js';
import * as sessionsRepo from '../../../data/repositories/sessions.js';
import { record as recordAudit } from '../../../data/repositories/audit.js';
import { setSessionCookie } from './session.js';
import type { MfaStatusResponse } from '../../../shared/api-types.js';

const LoginMfaBody = Type.Object({
  mfa_token: Type.String({ minLength: 1 }),
  method: Type.Union([Type.Literal('totp'), Type.Literal('recovery_code'), Type.Literal('webauthn')]),
  code: Type.Optional(Type.String()),
  response: Type.Optional(Type.Unknown())
});
type LoginMfaBody = Static<typeof LoginMfaBody>;

const StepUpBody = Type.Object({
  method: Type.Union([Type.Literal('totp'), Type.Literal('recovery_code'), Type.Literal('webauthn')]),
  code: Type.Optional(Type.String()),
  response: Type.Optional(Type.Unknown())
});
type StepUpBody = Static<typeof StepUpBody>;

const TotpConfirmBody = Type.Object({ code: Type.String({ minLength: 6, maxLength: 8 }) });
type TotpConfirmBody = Static<typeof TotpConfirmBody>;

const WebAuthnRegisterVerifyBody = Type.Object({
  response: Type.Unknown(),
  device_name: Type.Optional(Type.String({ maxLength: 100 }))
});
type WebAuthnRegisterVerifyBody = Static<typeof WebAuthnRegisterVerifyBody>;

/** Роли, для которых MFA — обязательная политика (§3 брифа). Само
 * ограничение реализовано не блокировкой всего API до enrollment'а (см.
 * ADR-010), а тем, что все step-up-gated опасные действия физически
 * недостижимы без хотя бы одного настроенного фактора — это поле только
 * управляет тем, что показывает /auth/mfa/status фронтенду как "нужно
 * дозаполнить". */
const MFA_MANDATORY_ROLES = new Set(['admin', 'supervisor']);

/**
 * Единая точка проверки одного из трёх факторов — переиспользуется и
 * login-time verify (POST /auth/mfa/login), и step-up (POST /auth/mfa/step-up).
 * WebAuthn — двухшаговая церемония (нужен отдельный /webauthn/options
 * запрос ДО этого вызова, challenge уже должен быть создан), TOTP и
 * recovery_code — однодверные.
 */
async function verifyFactor(employeeId: number, body: { method: string; code?: string; response?: unknown }): Promise<boolean> {
  if (body.method === 'totp') {
    return body.code ? totp.verifyConfirmedTotp(employeeId, body.code) : false;
  }
  if (body.method === 'recovery_code') {
    return body.code ? recoveryCodes.consumeRecoveryCode(employeeId, body.code) : false;
  }
  if (body.method === 'webauthn') {
    if (!body.response) return false;
    const result = await webauthn.finishAuthentication(employeeId, body.response as any);
    return result.verified;
  }
  return false;
}

export async function registerMfaRoutes(app: FastifyInstance) {
  // ===== Login-time second factor (после успешного пароля, до выдачи сессии) =====

  app.post(
    '/auth/login/mfa/webauthn/options',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { body: Type.Object({ mfa_token: Type.String() }) } },
    async (request, reply) => {
      const { mfa_token } = request.body as { mfa_token: string };
      const pending = await mfaRepo.resolvePendingLogin(mfa_token);
      if (!pending) return reply.code(400).send({ error: 'invalid_or_expired_mfa_token' });
      try {
        return await webauthn.startAuthentication(pending.employee_id);
      } catch {
        return reply.code(503).send({ error: 'webauthn_not_configured' });
      }
    }
  );

  app.post(
    '/auth/login/mfa',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { body: LoginMfaBody } },
    async (request, reply) => {
      const body = request.body as LoginMfaBody;
      const pending = await mfaRepo.resolvePendingLogin(body.mfa_token);
      if (!pending) return reply.code(400).send({ error: 'invalid_or_expired_mfa_token', message: 'Ссылка на вход истекла, начните заново' });

      const ok = await verifyFactor(pending.employee_id, body);
      if (!ok) return reply.code(401).send({ error: 'invalid_mfa_code', message: 'Неверный код' });

      await mfaRepo.consumePendingLogin(pending.id);
      const role = await employeesRepo.getRole(pending.employee_id);
      const token = await sessionsRepo.createSession(pending.employee_id, true, role);
      setSessionCookie(reply, token);
      return { ok: true };
    }
  );

  // ===== Step-up (свежее MFA-подтверждение для конкретного опасного действия) =====

  app.post(
    '/auth/mfa/step-up/webauthn/options',
    async (request, reply) => {
      if (!requireActive(request, reply)) return;
      try {
        return await webauthn.startAuthentication(request.user!.employee_id!);
      } catch {
        return reply.code(503).send({ error: 'webauthn_not_configured' });
      }
    }
  );

  app.post(
    '/auth/mfa/step-up',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { body: StepUpBody } },
    async (request, reply) => {
      if (!requireActive(request, reply)) return;
      const employeeId = request.user!.employee_id!;
      // Физически невозможно получить step-up ticket без хотя бы одного
      // настроенного фактора — это и есть реальное принудительное
      // применение "нет MFA → нет опасных действий" (см. ADR-010),
      // а не отдельный enrollment-гейт на каждый роут.
      if (!(await hasConfirmedMfaFactor(employeeId))) {
        return reply.code(400).send({ error: 'mfa_not_configured', message: 'Сначала настройте MFA (TOTP или ключ доступа)' });
      }
      const body = request.body as StepUpBody;
      const ok = await verifyFactor(employeeId, body);
      if (!ok) return reply.code(401).send({ error: 'invalid_mfa_code', message: 'Неверный код' });
      const ticket = await issueStepUpTicket(employeeId);
      return { ok: true, step_up_token: ticket };
    }
  );

  // ===== Общий статус =====

  app.get('/auth/mfa/status', async (request, reply): Promise<MfaStatusResponse | undefined> => {
    if (!requireActive(request, reply)) return;
    const employeeId = request.user!.employee_id!;
    const totpConfirmed = await totp.isTotpConfirmed(employeeId);
    const creds = await webauthn.listCredentials(employeeId);
    const remaining = await recoveryCodes.countRemainingRecoveryCodes(employeeId);
    const enabled = totpConfirmed || creds.length > 0;
    return {
      enabled,
      totp_confirmed: totpConfirmed,
      webauthn_credential_count: creds.length,
      recovery_codes_remaining: remaining,
      enrollment_required: MFA_MANDATORY_ROLES.has(request.user!.role) && !enabled
    };
  });

  // ===== TOTP enrollment =====

  app.post('/auth/mfa/totp/enroll', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const user = request.user!;
    const label = String(user.full_name || user.telegram_id || user.employee_id);
    const enrollment = await totp.startTotpEnrollment(user.employee_id!, label);
    // Секрет отдаётся клиенту РОВНО один раз, на этом ответе — после
    // confirm его больше никто не видит (§5: "never expose the secret
    // again after enrollment unless the enrollment flow specifically
    // requires it before confirmation" — здесь требует, это и есть тот момент).
    return enrollment;
  });

  app.post(
    '/auth/mfa/totp/confirm',
    // Security audit (20.52.0) — 6-значный код, брутфорсибельный без
    // лимита (1M комбинаций); тот же тир, что /auth/mfa/step-up.
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { body: TotpConfirmBody } },
    async (request, reply) => {
      if (!requireActive(request, reply)) return;
      const { code } = request.body as TotpConfirmBody;
      const ok = await totp.confirmTotpEnrollment(request.user!.employee_id!, code);
      if (!ok) return reply.code(400).send({ error: 'invalid_code', message: 'Неверный код — попробуйте ещё раз' });
      return { ok: true };
    }
  );

  app.delete('/auth/mfa/totp', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const employeeId = request.user!.employee_id!;
    // MFA-3 инвариант — отключение TOTP не должно тихо оставить
    // admin/supervisor вообще без фактора, если у него нет активного
    // WebAuthn-ключа взамен.
    if (MFA_MANDATORY_ROLES.has(request.user!.role)) {
      const creds = await webauthn.listCredentials(employeeId);
      if (creds.length === 0) {
        return reply.code(400).send({
          error: 'last_mfa_factor',
          message: 'Для вашей роли MFA обязателен — сначала добавьте ключ доступа (passkey) или другой фактор'
        });
      }
    }
    if (!(await assertStepUp(request, reply))) return;
    await totp.disableTotp(employeeId);
    return { ok: true };
  });

  // ===== WebAuthn enrollment =====

  app.post('/auth/mfa/webauthn/register/options', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const user = request.user!;
    try {
      return await webauthn.startRegistration(
        user.employee_id!,
        String(user.telegram_id || user.employee_id),
        String(user.full_name || 'T2 Sales')
      );
    } catch {
      return reply.code(503).send({ error: 'webauthn_not_configured', message: 'WebAuthn недоступен в этом окружении' });
    }
  });

  app.post(
    '/auth/mfa/webauthn/register/verify',
    { schema: { body: WebAuthnRegisterVerifyBody } },
    async (request, reply) => {
      if (!requireActive(request, reply)) return;
      const body = request.body as WebAuthnRegisterVerifyBody;
      const result = await webauthn.finishRegistration(
        request.user!.employee_id!,
        body.response as any,
        body.device_name ? String(body.device_name).slice(0, 100) : null
      );
      if (!result.verified) return reply.code(400).send({ error: 'verification_failed' });
      return { ok: true };
    }
  );

  app.get('/auth/mfa/webauthn/credentials', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const creds = await webauthn.listCredentials(request.user!.employee_id!);
    return creds.map((c) => ({
      id: c.id,
      device_name: c.device_name,
      device_type: c.device_type,
      backed_up: c.backed_up,
      created_at: c.created_at,
      last_used_at: c.last_used_at
    }));
  });

  app.delete('/auth/mfa/webauthn/credentials/:id', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const employeeId = request.user!.employee_id!;
    const { id } = request.params as { id: string };
    // MFA-3 — тот же last-factor guard, что у TOTP выше: нельзя убрать
    // последний оставшийся фактор у роли, для которой MFA обязателен.
    if (MFA_MANDATORY_ROLES.has(request.user!.role)) {
      const creds = await webauthn.listCredentials(employeeId);
      const totpOk = await totp.isTotpConfirmed(employeeId);
      const isLast = creds.length === 1 && creds[0].id === Number(id);
      if (isLast && !totpOk) {
        return reply.code(400).send({
          error: 'last_mfa_factor',
          message: 'Это последний фактор — для вашей роли MFA обязателен, добавьте другой перед удалением'
        });
      }
    }
    if (!(await assertStepUp(request, reply))) return;
    const revoked = await webauthn.revokeCredential(Number(id), employeeId);
    if (!revoked) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // ===== Recovery codes =====

  app.post('/auth/mfa/recovery-codes/generate', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const employeeId = request.user!.employee_id!;
    // Регенерация — если уже есть настроенный фактор, это заменяет
    // существующий набор кодов, поэтому требует step-up тем же приёмом,
    // что и любое другое чувствительное credential-действие; для ПЕРВОЙ
    // генерации (аккаунт ещё не имеет ни одного фактора) step-up
    // физически недостижим (см. /auth/mfa/step-up выше), поэтому здесь
    // разрешаем без него только когда факторов ещё нет вообще.
    if (await hasConfirmedMfaFactor(employeeId)) {
      if (!(await assertStepUp(request, reply))) return;
    }
    const codes = await recoveryCodes.generateRecoveryCodes(employeeId);
    // Коды отдаются один раз, здесь — дальше только их хеши в БД.
    return { ok: true, codes };
  });

  app.get('/auth/mfa/recovery-codes/status', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const remaining = await recoveryCodes.countRemainingRecoveryCodes(request.user!.employee_id!);
    return { remaining };
  });

  // ===== Admin: сброс MFA другого сотрудника =====

  app.post(
    '/employees/:id/mfa/reset',
    { preHandler: [requireEmployeeInOrg('params', 'id', { allowOrgOverride: true })] },
    async (request, reply) => {
      if (!requireManager(request, reply)) return;
      // Тот же уровень риска, что сброс пароля/выдача admin — сброс чужого
      // MFA снимает второй фактор с чужого аккаунта.
      if (!(await assertStepUp(request, reply))) return;
      const { id } = request.params as { id: string };
      const employeeId = Number(id);
      const orgId = resolveViewOrgId(request.user!, (request.query as any)?.org_id);

      await totp.disableTotp(employeeId);
      const creds = await webauthn.listCredentials(employeeId);
      for (const c of creds) await webauthn.revokeCredential(c.id, employeeId);
      await recoveryCodes.deleteAllRecoveryCodes(employeeId);
      // Сброс MFA — тот же класс риска, что смена пароля: все активные
      // browser-сессии отзываются, устройство с украденным/забытым вторым
      // фактором не должно оставаться залогиненным после сброса.
      await sessionsRepo.deleteAllForEmployee(employeeId);

      await recordAudit({
        orgId,
        actorEmployeeId: request.user!.employee_id,
        actorTelegramId: request.user!.telegram_id ? Number(request.user!.telegram_id) : null,
        action: 'employee.mfa_reset',
        targetType: 'employee',
        targetId: id,
        after: { totp: false, webauthn_credentials: 0, recovery_codes: 0 },
        requestId: request.id,
        actorRole: request.user!.role
      });

      return { ok: true };
    }
  );
}
