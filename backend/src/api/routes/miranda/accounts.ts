/**
 * T2 Miranda, этап 1 — admin-переключение на другой корпоративный аккаунт
 * (§3.4/§3.5 плана): список явно разрешённых аккаунтов + временная
 * активация на текущей сессии, без изменения постоянной привязки
 * устройства. Права на переключение — explicit грант (миранда-devices.ts
 * не читается здесь), не выводятся из одной лишь роли admin.
 */
import { FastifyInstance } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { requireActive, requireAdmin } from '../../../auth/guards.js';
import * as mirandaService from '../../../core/miranda-accounts/service.js';
import * as messengerService from '../../../core/messenger/service.js';

const AvailableQuery = Type.Object({
  deviceSecret: Type.Optional(Type.String({ maxLength: 128 }))
});
type AvailableQuery = Static<typeof AvailableQuery>;

const ContactsQuery = Type.Object({
  q: Type.String({ minLength: 2, maxLength: 100 })
});
type ContactsQuery = Static<typeof ContactsQuery>;

const SwitchBody = Type.Object({
  corporateAccountId: Type.Integer()
});
type SwitchBody = Static<typeof SwitchBody>;

const GrantBody = Type.Object({
  adminEmployeeId: Type.Integer(),
  corporateAccountId: Type.Integer()
});
type GrantBody = Static<typeof GrantBody>;

const DeviceExclusiveParams = Type.Object({ id: Type.String({ pattern: '^[0-9]+$' }) });
type DeviceExclusiveParams = Static<typeof DeviceExclusiveParams>;

const DeviceExclusiveBody = Type.Object({ deviceExclusive: Type.Boolean() });
type DeviceExclusiveBody = Static<typeof DeviceExclusiveBody>;

export async function registerMirandaAccountRoutes(app: FastifyInstance) {
  // Поиск контакта для обычного (не-admin) пользователя мессенджера,
  // чтобы начать диалог (§4 плана) — все остальные роуты этого файла
  // requireAdmin, что оставляло обычных сотрудников без способа найти
  // targetCorporateAccountId для POST /miranda/conversations/direct.
  // Та же форма, что /admin/search (минимум 2 символа, 20 результатов),
  // но без admin-гейта и с исключением собственного активного аккаунта.
  app.get('/miranda/contacts', { schema: { querystring: ContactsQuery } }, async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const sessionToken = request.sessionToken;
    const ownAccountId = sessionToken ? await messengerService.resolveActiveCorporateAccount(sessionToken) : null;
    const { q } = request.query as ContactsQuery;
    const items = await mirandaService.searchCorporateAccounts(request.user!.org_id, q, ownAccountId);
    return reply.code(200).send({ items });
  });

  // Весь список активных корпоративных аккаунтов сети — нужен UI выдачи
  // гранта (Admin Control Center), т.к. listPendingBindings показывает
  // только НЕодобренные устройства, а listAvailableAccountsForAdmin —
  // только то, что уже разрешено запрашивающему админу (замкнутый круг
  // без этого роута, см. обсуждение этапа 3 плана).
  app.get('/miranda/accounts', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const items = await mirandaService.listAllCorporateAccounts(request.user!.org_id);
    return reply.code(200).send({ items });
  });

  // Помечает аккаунт как "точка/касса" (должен быть привязан ровно к
  // одному устройству одновременно — enforced в approveBinding, см.
  // core/miranda-accounts/service.ts) или возвращает к обычному личному
  // поведению (несколько одновременно активных устройств разрешены).
  app.patch(
    '/miranda/accounts/:id/device-exclusive',
    { schema: { params: DeviceExclusiveParams, body: DeviceExclusiveBody } },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const { id } = request.params as DeviceExclusiveParams;
      const { deviceExclusive } = request.body as DeviceExclusiveBody;
      const ok = await mirandaService.setAccountDeviceExclusive(Number(id), deviceExclusive, request.user!.employee_id!, request.user!.org_id);
      if (!ok) return reply.code(404).send({ error: 'account_not_found' });
      return reply.code(200).send({ ok: true });
    }
  );

  app.get(
    '/miranda/accounts/available',
    { schema: { querystring: AvailableQuery } },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const { deviceSecret } = request.query as AvailableQuery;
      const items = await mirandaService.listAvailableAccountsForAdmin(request.user!.employee_id!, deviceSecret || null);
      return reply.code(200).send({ items });
    }
  );

  app.post(
    '/miranda/session/switch',
    { schema: { body: SwitchBody } },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const sessionToken = request.sessionToken;
      if (!sessionToken) {
        return reply.code(409).send({ error: 'no_session_token', message: 'Miranda требует сессионный вход (телефон+пароль)' });
      }
      const { corporateAccountId } = request.body as SwitchBody;
      const result = await mirandaService.switchSessionAccount(request.user!.employee_id!, request.user!.org_id, sessionToken, corporateAccountId);
      if (result.ok === false) {
        const statusCode = result.error === 'not_granted' ? 403 : 404;
        return reply.code(statusCode).send({ error: result.error });
      }
      return reply.code(200).send({ ok: true });
    }
  );

  // Admin Control Center — выдача гранта "этому админу разрешено временно
  // использовать этот корпоративный аккаунт" (§3.5). Сам список точек/
  // аккаунтов для грантования строится на UI поверх уже существующих
  // Admin Control Center справочников (сотрудники/точки) — здесь только
  // запись самого гранта и аудит.
  app.post(
    '/miranda/admin-grants',
    { schema: { body: GrantBody } },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const { adminEmployeeId, corporateAccountId } = request.body as GrantBody;
      await mirandaService.grantAdminAccount(adminEmployeeId, corporateAccountId, request.user!.employee_id!, request.user!.org_id);
      return reply.code(200).send({ ok: true });
    }
  );
}
