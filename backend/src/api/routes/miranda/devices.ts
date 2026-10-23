/**
 * T2 Miranda, этап 1 — регистрация/активация устройства (обычный
 * сотрудник, уже прошедший стандартный T2 Sales логин) + admin-очередь
 * подтверждения (Admin Control Center "Устройства Miranda").
 * org_id/employee_id — ВСЕГДА из request.user, никогда из тела запроса
 * (см. заголовок core/miranda-accounts/service.ts).
 */
import { FastifyInstance } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { requireActive, requireAdmin, resolveViewOrgId, assertStoreInOrg } from '../../../auth/guards.js';
import { resolveDealerOrgIds } from '../../../core/orgs/dealers.js';
import { assertStepUp } from '../../../auth/step-up.js';
import * as mirandaService from '../../../core/miranda-accounts/service.js';
import { employeeAwareKeyGenerator } from '../../../security/rate-limit.js';

const RegisterDeviceBody = Type.Object({
  platform: Type.Union([Type.Literal('windows'), Type.Literal('android')]),
  storeId: Type.Optional(Type.Union([Type.String({ maxLength: 64 }), Type.Null()])),
  label: Type.Optional(Type.Union([Type.String({ maxLength: 200 }), Type.Null()]))
});
type RegisterDeviceBody = Static<typeof RegisterDeviceBody>;

const ActivateDeviceBody = Type.Object({
  deviceSecret: Type.String({ minLength: 32, maxLength: 128 })
});
type ActivateDeviceBody = Static<typeof ActivateDeviceBody>;

const ApproveParams = Type.Object({ id: Type.String({ pattern: '^[0-9]+$' }) });
type ApproveParams = Static<typeof ApproveParams>;

export async function registerMirandaDeviceRoutes(app: FastifyInstance) {
  app.post(
    '/miranda/devices/register',
    {
      schema: { body: RegisterDeviceBody },
      config: {
        rateLimit: { max: 10, timeWindow: '1 minute', hook: 'preHandler', keyGenerator: employeeAwareKeyGenerator('miranda_register') }
      }
    },
    async (request, reply) => {
      if (!requireActive(request, reply)) return;
      const body = request.body as RegisterDeviceBody;
      const orgId = request.user!.org_id;
      const employeeId = request.user!.employee_id!;
      const storeId = body.storeId || null;
      if (storeId && !(await assertStoreInOrg(storeId, orgId))) {
        return reply.code(403).send({ error: 'forbidden', message: 'Точка не принадлежит вашей сети' });
      }
      const result = await mirandaService.registerDevice(orgId, employeeId, storeId, body.platform, body.label || null);
      return reply.code(200).send({
        deviceId: Number(result.deviceId),
        deviceSecret: result.deviceSecret,
        status: result.bindingStatus
      });
    }
  );

  app.post(
    '/miranda/devices/activate',
    {
      schema: { body: ActivateDeviceBody },
      config: {
        rateLimit: { max: 30, timeWindow: '1 minute', hook: 'preHandler', keyGenerator: employeeAwareKeyGenerator('miranda_activate') }
      }
    },
    async (request, reply) => {
      if (!requireActive(request, reply)) return;
      const body = request.body as ActivateDeviceBody;
      const employeeId = request.user!.employee_id!;
      const sessionToken = request.sessionToken;
      if (!sessionToken) {
        // Miranda — native-приложение на том же cookie-сессионном входе, что
        // desktopApp/androidApp уже используют (не Telegram Mini App,
        // см. заголовок core/miranda-accounts/service.ts) — отсутствие
        // sessionToken здесь означает вызов не из того клиента/канала.
        return reply.code(409).send({ error: 'no_session_token', message: 'Miranda требует сессионный вход (телефон+пароль)' });
      }
      const result = await mirandaService.activateDevice(body.deviceSecret, employeeId, sessionToken);
      if (result.status === 'unknown_device') {
        return reply.code(404).send({ error: 'unknown_device', message: 'Устройство не найдено или отозвано' });
      }
      if (result.status === 'pending') {
        return reply.code(202).send({ status: 'pending', message: 'Ожидайте подтверждения администратора' });
      }
      return reply.code(200).send({ status: 'active', corporateAccountId: Number(result.corporateAccountId), displayLabel: result.displayLabel });
    }
  );

  // Очередь подтверждения — весь дилер (как /miranda/accounts и
  // /miranda/contacts/all): без этого устройства соседних сетей дилера
  // админ не видел нигде. ?org_id= — какая сеть считается "своей" для
  // дилерской группы (resolveViewOrgId), по умолчанию собственная.
  app.get('/miranda/devices', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const orgId = resolveViewOrgId(request.user!, (request.query as any)?.org_id);
    const dealerOrgIds = await resolveDealerOrgIds(orgId);
    const items = await mirandaService.listPendingBindings(dealerOrgIds);
    return reply.code(200).send({ items });
  });

  app.post(
    '/miranda/devices/:id/approve',
    { schema: { params: ApproveParams } },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      if (!(await assertStepUp(request, reply))) return;
      const { id } = request.params as ApproveParams;
      const result = await mirandaService.approveBinding(Number(id), request.user!.employee_id!, request.user!.org_id);
      if (result.ok === false) {
        if (result.error === 'device_exclusive_conflict') {
          return reply.code(409).send({
            error: 'device_exclusive_conflict',
            message: 'Этот аккаунт уже привязан к другому активному устройству'
          });
        }
        return reply.code(404).send({ error: 'binding_not_found' });
      }
      return reply.code(200).send({ ok: true });
    }
  );

  app.post(
    '/miranda/devices/:id/revoke',
    { schema: { params: ApproveParams } },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const { id } = request.params as ApproveParams;
      const ok = await mirandaService.revokeBinding(Number(id), request.user!.employee_id!, request.user!.org_id);
      if (!ok) return reply.code(404).send({ error: 'binding_not_found' });
      return reply.code(200).send({ ok: true });
    }
  );
}
