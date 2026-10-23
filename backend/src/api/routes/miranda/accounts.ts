/**
 * T2 Miranda, этап 1 — admin-переключение на другой корпоративный аккаунт
 * (§3.4/§3.5 плана): список явно разрешённых аккаунтов + временная
 * активация на текущей сессии, без изменения постоянной привязки
 * устройства. Права на переключение — explicit грант (миранда-devices.ts
 * не читается здесь), не выводятся из одной лишь роли admin.
 */
import { FastifyInstance } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { requireActive, requireAdmin, resolveViewOrgId, assertEmployeeInOrg, assertStoreInOrg } from '../../../auth/guards.js';
import * as mirandaService from '../../../core/miranda-accounts/service.js';
import { resolveMirandaPrincipal } from '../../../core/miranda-accounts/service.js';
import * as messengerService from '../../../core/messenger/service.js';
import * as orgsRepo from '../../../data/repositories/organizations.js';
import { normalizePhone } from '../../../utils/phone.js';

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

// orgId — опционально, в какой сети заводить аккаунт (любая сеть любого
// дилера — admin глобальный, см. resolveViewOrgId; проверяется, что сеть
// вообще существует); отсутствует — своя сеть (обратная совместимость).
const CreatePersonalAccountBody = Type.Object({
  employeeId: Type.Integer(),
  storeId: Type.Optional(Type.Union([Type.String({ maxLength: 64 }), Type.Null()])),
  displayLabel: Type.Optional(Type.Union([Type.String({ maxLength: 200 }), Type.Null()])),
  orgId: Type.Optional(Type.String({ maxLength: 64 }))
});

// Этап B (вариант B) — аккаунт точки/кассы: собственный вход по телефону+
// паролю, без привязки к конкретному сотруднику.
const CreatePointAccountBody = Type.Object({
  phone: Type.String({ minLength: 5, maxLength: 32 }),
  password: Type.String({ minLength: 8, maxLength: 200 }),
  accountName: Type.String({ minLength: 1, maxLength: 200 }),
  storeId: Type.Optional(Type.Union([Type.String({ maxLength: 64 }), Type.Null()])),
  orgId: Type.Optional(Type.String({ maxLength: 64 }))
});

const CreateAccountBody = Type.Union([CreatePersonalAccountBody, CreatePointAccountBody]);
type CreateAccountBody = Static<typeof CreateAccountBody>;

const DeviceExclusiveParams = Type.Object({ id: Type.String({ pattern: '^[0-9]+$' }) });
type DeviceExclusiveParams = Static<typeof DeviceExclusiveParams>;

const DeviceExclusiveBody = Type.Object({ deviceExclusive: Type.Boolean() });
type DeviceExclusiveBody = Static<typeof DeviceExclusiveBody>;

// §1 плана — ручное переключение своего статуса "в сети"; 'auto' возвращает
// к автоопределению по живому WS-сокету мессенджера.
const SetPresenceBody = Type.Object({
  status: Type.Union([Type.Literal('online'), Type.Literal('offline'), Type.Literal('auto')])
});
type SetPresenceBody = Static<typeof SetPresenceBody>;

// §G плана — самостоятельное переименование (любой принципал меняет свой
// display_label); null сбрасывает на дефолт (имя сотрудника/account_name).
const SetDisplayLabelBody = Type.Object({
  displayLabel: Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()])
});
type SetDisplayLabelBody = Static<typeof SetDisplayLabelBody>;

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
    const dealerOrgIds = await mirandaService.resolveDealerOrgIds(request.user!.org_id);
    const items = await mirandaService.searchCorporateAccounts(dealerOrgIds, q, ownAccountId);
    return reply.code(200).send({ items });
  });

  // Дерево контактов для главного экрана мессенджера (аналог основного
  // окна Miranda NG: все точки/сотрудники сети, сгруппированные по точке,
  // всегда видны — не только по явному поисковому запросу, как
  // /miranda/contacts). Доступно и сотруднику, и аккаунту точки (Этап B) —
  // поэтому resolveMirandaPrincipal, а не requireActive/requireAdmin.
  // Видимость — весь дилер (dealerOrgIds), не только своя сеть.
  app.get('/miranda/contacts/all', async (request, reply) => {
    const principal = await resolveMirandaPrincipal(request, reply);
    if (!principal) return;
    const items = await mirandaService.listAllCorporateAccounts(principal.dealerOrgIds);
    return reply.code(200).send({ items });
  });

  // Весь список активных корпоративных аккаунтов сети — нужен UI выдачи
  // гранта (Admin Control Center), т.к. listPendingBindings показывает
  // только НЕодобренные устройства, а listAvailableAccountsForAdmin —
  // только то, что уже разрешено запрашивающему админу (замкнутый круг
  // без этого роута, см. обсуждение этапа 3 плана).
  // Администрирование — глобально, любая сеть любого дилера (как и
  // остальной Admin Control Center — resolveViewOrgId, см.
  // auth/guards.ts): единственный админ управляет всем приложением, не
  // только своим дилером. ?org_id= выбирает, какую сеть смотреть —
  // своя по умолчанию.
  app.get('/miranda/accounts', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const orgId = resolveViewOrgId(request.user!, (request.query as any)?.org_id);
    const includeInactive = (request.query as any)?.include_inactive === '1' || (request.query as any)?.include_inactive === 'true';
    const items = await mirandaService.listAllCorporateAccounts([orgId], includeInactive);
    return reply.code(200).send({ items });
  });

  // Admin Control Center — явное создание корпоративного аккаунта, не
  // зависящее от регистрации устройства (ту ветку создаёт registerDevice
  // неявно через findOrCreateCorporateAccount). Нужно, когда аккаунт
  // хотят завести заранее — например, выдать грант на переключение до
  // того, как к точке впервые привяжут устройство.
  app.post(
    '/miranda/accounts',
    { schema: { body: CreateAccountBody } },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const body = request.body as CreateAccountBody;
      const orgId = resolveViewOrgId(request.user!, body.orgId);
      if (orgId !== request.user!.org_id && !(await orgsRepo.findActiveById(orgId))) {
        return reply.code(404).send({ error: 'org_not_found', message: 'Сеть не найдена' });
      }

      if ('phone' in body) {
        const { phone, password, accountName, storeId } = body;
        const normalizedPhone = normalizePhone(phone);
        if (!normalizedPhone) {
          return reply.code(400).send({ error: 'invalid_phone', message: 'Некорректный формат телефона' });
        }
        if (storeId && !(await assertStoreInOrg(storeId, orgId))) {
          return reply.code(403).send({ error: 'forbidden', message: 'Точка не принадлежит вашей сети' });
        }
        const result = await mirandaService.createPointCorporateAccount(orgId, normalizedPhone, password, accountName, storeId || null, request.user!.employee_id!);
        if (result.ok === false) {
          return reply.code(409).send({ error: 'phone_conflict', message: 'Аккаунт с таким телефоном уже существует в вашей сети' });
        }
        return reply.code(201).send({ item: result.account });
      }

      const { employeeId, storeId, displayLabel } = body;
      if (!(await assertEmployeeInOrg(employeeId, orgId))) {
        return reply.code(403).send({ error: 'forbidden', message: 'Сотрудник не принадлежит вашей сети' });
      }
      if (storeId && !(await assertStoreInOrg(storeId, orgId))) {
        return reply.code(403).send({ error: 'forbidden', message: 'Точка не принадлежит вашей сети' });
      }
      const result = await mirandaService.createCorporateAccount(orgId, employeeId, storeId || null, displayLabel || null, request.user!.employee_id!);
      if (result.ok === false) {
        return reply.code(409).send({ error: 'conflict', message: 'Такой корпоративный аккаунт уже существует' });
      }
      return reply.code(201).send({ item: result.account });
    }
  );

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
  // §1 плана — ручное переключение своего статуса "в сети"/"не в сети".
  // Доступно и сотруднику, и аккаунту точки (resolveMirandaPrincipal) —
  // всегда пишет на свой же corporateAccountId из принципала, никогда из
  // тела запроса.
  app.patch(
    '/miranda/presence',
    { schema: { body: SetPresenceBody } },
    async (request, reply) => {
      const principal = await resolveMirandaPrincipal(request, reply);
      if (!principal) return;
      const { status } = request.body as SetPresenceBody;
      await mirandaService.setPresence(principal.corporateAccountId, status === 'auto' ? null : status, principal.orgId);
      return reply.code(200).send({ ok: true });
    }
  );

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

  // Деактивация ненужного аккаунта (не удаление — обратимо, история/
  // данные не трогаются). Деактивированный аккаунт уже автоматически
  // пропадает из contacts/search (listAllCorporateAccounts/
  // searchCorporateAccounts фильтруют is_active), не может войти
  // (/miranda/accounts/login проверяет is_active), и его живой WS рвётся
  // на следующем heartbeat (isMessengerConnectionStillValid в ws.ts) —
  // ничего дополнительно чистить не нужно. Глобально, любая сеть.
  app.post('/miranda/accounts/:id/deactivate', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const ok = await mirandaService.deactivateAccount(Number(id), request.user!.employee_id!);
    if (!ok) return reply.code(404).send({ error: 'account_not_found' });
    return reply.code(200).send({ ok: true });
  });

  app.post('/miranda/accounts/:id/reactivate', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const ok = await mirandaService.reactivateAccount(Number(id), request.user!.employee_id!);
    if (!ok) return reply.code(404).send({ error: 'account_not_found' });
    return reply.code(200).send({ ok: true });
  });

  // Самостоятельное переименование — любой принципал Miranda (сотрудник
  // или точка) меняет СВОЙ display_label, никогда чужой: corporateAccountId
  // всегда берётся из resolveMirandaPrincipal, не из тела запроса.
  app.get('/miranda/accounts/me', async (request, reply) => {
    const principal = await resolveMirandaPrincipal(request, reply);
    if (!principal) return;
    const item = await mirandaService.getOwnAccount(principal.corporateAccountId);
    if (!item) return reply.code(404).send({ error: 'account_not_found' });
    return reply.code(200).send({ item });
  });

  app.patch(
    '/miranda/accounts/me',
    { schema: { body: SetDisplayLabelBody } },
    async (request, reply) => {
      const principal = await resolveMirandaPrincipal(request, reply);
      if (!principal) return;
      const { displayLabel } = request.body as SetDisplayLabelBody;
      await mirandaService.setOwnDisplayLabel(principal.corporateAccountId, displayLabel);
      return reply.code(200).send({ ok: true });
    }
  );
}
