/**
 * T2 Miranda, этап 1 (Этап A плана, §3/§3.4/§3.5) — оркестрация
 * корпоративных аккаунтов/устройств/привязок/admin-переключения. Единственное
 * место, где REST-роуты miranda/* трогают эту бизнес-логику; org_id/
 * employee_id сюда ВСЕГДА приходят из request.user (authenticated
 * principal), никогда из тела запроса — тот же инвариант, что
 * core/chat/service.ts, проверяется isolation-тестами, не этим файлом.
 *
 * Miranda — отдельное native-приложение (Windows/Android), построенное на
 * том же клиентском auth-слое, что desktopApp/androidApp уже используют
 * сегодня (телефон+пароль, cookie-сессия employee_sessions) — НЕ на
 * Telegram Mini App потоке (stateless HMAC initData, без персистентной
 * сессии, ADR-005). Поэтому "активный корпоративный аккаунт на текущей
 * сессии" (employee_sessions.active_corporate_account_id) всегда имеет,
 * на чём жить — у каждого Miranda-запроса есть настоящая сессия с
 * token_hash, как у любого другого non-Telegram входа в этом кодбейзе.
 */
import { withTransaction } from '../../data/db/index.js';
import * as mirandaRepo from '../../data/repositories/miranda-accounts.js';
import * as contactGroupsRepo from '../../data/repositories/miranda-contact-groups.js';
import { hashToken } from '../../data/repositories/sessions.js';
import * as auditRepo from '../../data/repositories/audit.js';
import { hashPassword } from '../../auth/password.js';
import { requireActive } from '../../auth/guards.js';
import * as pointSessionsRepo from '../../data/repositories/corporate-account-sessions.js';
import { connectionCountForAccount } from '../messenger/realtime-registry.js';
import { resolveDealerOrgIds } from '../orgs/dealers.js';

export interface MirandaPrincipal {
  orgId: string;
  corporateAccountId: number;
  /** null для точечного (Этап B) принципала — нет живого сотрудника за аккаунтом. */
  actorEmployeeId: number | null;
  /** Видимость контактов/групп/переписки в рамках всего дилера (не одной
   * сети) — все org_id дилера, которому принадлежит orgId, включая сам
   * orgId; [orgId] же, если у сети нет дилера (см. core/orgs/dealers.ts).
   * Администрирование аккаунтов (requireAdmin-роуты в accounts.ts)
   * намеренно НЕ использует это поле — остаётся строго по своей сети. */
  dealerOrgIds: string[];
}

/** Этап B §4 плана — единая точка резолюции "кто сейчас пишет в
 * мессенджер Miranda", параллельная двум разным входам:
 * 1. Точечный аккаунт (телефон+пароль, cookie `t2_point_session`) —
 *    проверяется первым, не трогает employee-сессию вообще.
 * 2. Обычный сотрудник (`requireActive` + активный corporate_account_id
 *    на employee_sessions) — существующий путь Этапа A, без изменений.
 * Ни одно, ни другое — сама функция уже отправила 401/409 в reply.
 * request/reply типизированы как `any` намеренно — core/ не может
 * импортировать fastify напрямую (см. docs/ARCHITECTURE.md), это тот же
 * приём, что уже используют api/routes/miranda/messenger.ts's
 * локальные guard-хелперы. */
export async function resolveMirandaPrincipal(request: any, reply: any): Promise<MirandaPrincipal | null> {
  const pointToken = request.cookies?.[pointSessionsRepo.POINT_COOKIE_NAME];
  if (pointToken) {
    const session = await pointSessionsRepo.resolve(pointToken);
    if (!session) {
      reply.code(401).send({ error: 'invalid_point_session', message: 'Сессия точки недействительна или истекла' });
      return null;
    }
    const account = await mirandaRepo.getCorporateAccount(session.corporate_account_id);
    if (!account || !account.is_active) {
      reply.code(401).send({ error: 'invalid_point_session', message: 'Сессия точки недействительна или истекла' });
      return null;
    }
    await pointSessionsRepo.touch(pointToken);
    const dealerOrgIds = await resolveDealerOrgIds(account.org_id);
    return { orgId: account.org_id, corporateAccountId: account.id, actorEmployeeId: null, dealerOrgIds };
  }

  if (!requireActive(request, reply)) return null;
  const sessionToken = request.sessionToken;
  if (!sessionToken) {
    reply.code(409).send({ error: 'no_session_token', message: 'Miranda требует сессионный вход (телефон+пароль)' });
    return null;
  }
  const corporateAccountId = await mirandaRepo.getActiveCorporateAccountForSession(hashToken(sessionToken));
  if (!corporateAccountId) {
    reply.code(409).send({ error: 'no_active_corporate_account', message: 'Нет активного корпоративного аккаунта на этом устройстве' });
    return null;
  }
  const dealerOrgIds = await resolveDealerOrgIds(request.user!.org_id);
  return { orgId: request.user!.org_id, corporateAccountId, actorEmployeeId: request.user!.employee_id!, dealerOrgIds };
}

/** Публичный ре-экспорт для роутов, которые мутируют группы контактов
 * через requireAdmin (не через resolveMirandaPrincipal) — см.
 * api/routes/miranda/contact-groups.ts. */
export { resolveDealerOrgIds };

export interface RegisterDeviceResult {
  deviceId: number;
  deviceSecret: string;
  bindingStatus: 'pending' | 'active';
}

/**
 * §3.4 "Первичная регистрация" — клиент уже прошёл обычный T2 Sales логин
 * (сотрудник известен из сессии), генерирует секрет сам и шлёт сюда только
 * его hash неявно (через повторный /activate) — здесь сервер генерирует
 * секрет сам и возвращает его ОДИН раз в ответе; клиент обязан сохранить
 * его в DPAPI/Keystore сразу же, повторно он никогда не будет показан (тот
 * же принцип, что generateToken()/createSession() в sessions.ts).
 */
export async function registerDevice(
  orgId: string,
  employeeId: number,
  storeId: string | null,
  platform: 'windows' | 'android',
  label: string | null
): Promise<RegisterDeviceResult> {
  return withTransaction(async (q) => {
    const account = await mirandaRepo.findOrCreateCorporateAccount(orgId, employeeId, storeId, label, q);
    const secret = mirandaRepo.generateDeviceSecret();
    const device = await mirandaRepo.createDevice(secret, platform, label, q);
    // 20.78.0 — авто-approve ПЕРВОГО устройства личного аккаунта: без него
    // вход в Miranda упирался в pending-байндинг, а подтвердить его мог только
    // ДРУГОЙ админ — у единственного админа профиль в Miranda не появлялся
    // вообще. Аккаунты точки/кассы (device_exclusive) и второе+ устройства
    // по-прежнему ждут approve в очереди.
    const autoApprove = !account.device_exclusive && !(await mirandaRepo.hasOtherActiveBinding(account.id, device.id, q));
    const binding = await mirandaRepo.createBinding(device.id, account.id, autoApprove ? 'active' : 'pending', autoApprove ? employeeId : null, q);
    await auditRepo.record(
      {
        orgId,
        actorEmployeeId: employeeId,
        actorTelegramId: null,
        action: 'MIRANDA_DEVICE_REGISTERED',
        targetType: 'miranda_device',
        targetId: String(device.id),
        after: { platform, corporateAccountId: account.id, bindingId: binding.id, autoApproved: autoApprove }
      },
      q
    );
    return { deviceId: device.id, deviceSecret: secret, bindingStatus: binding.status as 'pending' | 'active' };
  });
}

export type ActivateDeviceResult =
  | { status: 'active'; corporateAccountId: number; displayLabel: string | null }
  | { status: 'pending' }
  | { status: 'unknown_device' };

/**
 * §3.3 — вызывается на КАЖДОМ старте клиента (не кэшируется клиентом как
 * булев флаг "уже вошёл"): сервер каждый раз заново смотрит текущий статус
 * привязки, поэтому мгновенный revoke админом немедленно блокирует
 * следующий же запуск, без какой-либо логики отзыва на самом клиенте.
 */
export async function activateDevice(
  deviceSecret: string,
  employeeId: number,
  sessionToken: string
): Promise<ActivateDeviceResult> {
  const device = await mirandaRepo.findDeviceBySecret(deviceSecret);
  if (!device || device.status === 'revoked') return { status: 'unknown_device' };

  const activeBinding = await mirandaRepo.findActiveBindingForEmployee(device.id, employeeId);
  if (activeBinding) {
    await mirandaRepo.touchDeviceLastSeen(device.id);
    const account = await mirandaRepo.getCorporateAccount(activeBinding.corporate_account_id);
    await mirandaRepo.setActiveCorporateAccountForSession(hashToken(sessionToken), activeBinding.corporate_account_id);
    return { status: 'active', corporateAccountId: activeBinding.corporate_account_id, displayLabel: account?.display_label ?? null };
  }

  const pendingBinding = await mirandaRepo.findPendingBindingForEmployee(device.id, employeeId);
  if (pendingBinding) return { status: 'pending' };

  return { status: 'unknown_device' };
}

/**
 * §3.4 "Подтверждение администратором" — requireAdmin + requireStepUp() —
 * оба проверяются в самом роуте (route auth policy ratchet требует
 * guard-вызова прямо в хендлере), здесь только бизнес-эффект и аудит.
 *
 * device_exclusive-аккаунты (точка/касса — должны быть привязаны ровно к
 * одному устройству, см. corporate_accounts.device_exclusive) не могут
 * получить вторую одновременно активную привязку: если такая уже есть на
 * другом устройстве, approve отклоняется явной ошибкой — админ должен
 * сначала revoke старую привязку. Личные аккаунты (device_exclusive=false)
 * не ограничены — тот же сотрудник может работать с нескольких устройств.
 */
export type ApproveBindingResult = { ok: true } | { ok: false; error: 'not_found' | 'device_exclusive_conflict' };

export async function approveBinding(bindingId: number, approvedByEmployeeId: number, approverOrgId: string): Promise<ApproveBindingResult> {
  return withTransaction(async (q) => {
    const pending = await mirandaRepo.getBinding(bindingId);
    if (!pending || pending.status !== 'pending') return { ok: false, error: 'not_found' };

    const account = await mirandaRepo.getCorporateAccount(pending.corporate_account_id);
    if (account?.device_exclusive) {
      const conflict = await mirandaRepo.hasOtherActiveBinding(pending.corporate_account_id, pending.device_id, q);
      if (conflict) return { ok: false, error: 'device_exclusive_conflict' };
    }

    const binding = await mirandaRepo.approveBinding(bindingId, approvedByEmployeeId, q);
    if (!binding) return { ok: false, error: 'not_found' };
    await auditRepo.record(
      {
        orgId: approverOrgId,
        actorEmployeeId: approvedByEmployeeId,
        actorTelegramId: null,
        action: 'MIRANDA_DEVICE_APPROVED',
        targetType: 'miranda_device_binding',
        targetId: String(binding.id),
        after: { deviceId: binding.device_id, corporateAccountId: binding.corporate_account_id }
      },
      q
    );
    return { ok: true };
  });
}

/** Admin Control Center — помечает корпоративный аккаунт как "точка/касса"
 * (device_exclusive=true, enforced в approveBinding выше) или возвращает
 * к обычному личному поведению (device_exclusive=false). */
export async function setAccountDeviceExclusive(
  corporateAccountId: number,
  deviceExclusive: boolean,
  actorEmployeeId: number,
  orgId: string
): Promise<boolean> {
  return withTransaction(async (q) => {
    const before = await mirandaRepo.getCorporateAccount(corporateAccountId);
    const updated = await mirandaRepo.setCorporateAccountDeviceExclusive(corporateAccountId, deviceExclusive, q);
    if (!updated) return false;
    await auditRepo.record(
      {
        orgId,
        actorEmployeeId,
        actorTelegramId: null,
        action: 'MIRANDA_ACCOUNT_DEVICE_EXCLUSIVE_SET',
        targetType: 'corporate_account',
        targetId: String(corporateAccountId),
        before: { device_exclusive: before?.device_exclusive },
        after: { device_exclusive: updated.device_exclusive }
      },
      q
    );
    return true;
  });
}

/** §C плана — деактивация/реактивация, глобально (любая сеть, admin
 * единый на всё приложение — см. §A). orgId для аудита берётся из самой
 * записи аккаунта (та сеть, которой он реально принадлежит), не из
 * actор'а — иначе аудит чужой сети писался бы под org_id админа. */
export async function deactivateAccount(corporateAccountId: number, actorEmployeeId: number): Promise<boolean> {
  return withTransaction(async (q) => {
    const before = await mirandaRepo.getCorporateAccount(corporateAccountId);
    if (!before) return false;
    const updated = await mirandaRepo.setAccountActive(corporateAccountId, false, q);
    if (!updated) return false;
    await auditRepo.record(
      { orgId: before.org_id, actorEmployeeId, actorTelegramId: null, action: 'MIRANDA_ACCOUNT_DEACTIVATED', targetType: 'corporate_account', targetId: String(corporateAccountId), before: { is_active: true }, after: { is_active: false } },
      q
    );
    return true;
  });
}

export async function reactivateAccount(corporateAccountId: number, actorEmployeeId: number): Promise<boolean> {
  return withTransaction(async (q) => {
    const before = await mirandaRepo.getCorporateAccount(corporateAccountId);
    if (!before) return false;
    const updated = await mirandaRepo.setAccountActive(corporateAccountId, true, q);
    if (!updated) return false;
    await auditRepo.record(
      { orgId: before.org_id, actorEmployeeId, actorTelegramId: null, action: 'MIRANDA_ACCOUNT_REACTIVATED', targetType: 'corporate_account', targetId: String(corporateAccountId), before: { is_active: false }, after: { is_active: true } },
      q
    );
    return true;
  });
}

/** §G плана — самостоятельное переименование: GET для предзаполнения
 * поля в Settings, PATCH пишет только на свой же corporateAccountId
 * (вызывающий роут берёт id из resolveMirandaPrincipal, не из тела). */
export async function getOwnAccount(corporateAccountId: number) {
  return mirandaRepo.getCorporateAccount(corporateAccountId);
}

export async function setOwnDisplayLabel(corporateAccountId: number, displayLabel: string | null): Promise<void> {
  await mirandaRepo.setDisplayLabel(corporateAccountId, displayLabel);
}

export async function revokeBinding(bindingId: number, revokedByEmployeeId: number, revokerOrgId: string): Promise<boolean> {
  return withTransaction(async (q) => {
    const before = await mirandaRepo.getBinding(bindingId);
    const binding = await mirandaRepo.revokeBinding(bindingId, q);
    if (!binding) return false;
    await auditRepo.record(
      {
        orgId: revokerOrgId,
        actorEmployeeId: revokedByEmployeeId,
        actorTelegramId: null,
        action: 'MIRANDA_DEVICE_REVOKED',
        targetType: 'miranda_device_binding',
        targetId: String(binding.id),
        before: { status: before?.status },
        after: { status: binding.status }
      },
      q
    );
    return true;
  });
}

/** §3.4 "Администратор временно использует другой аккаунт" — §3.5 allowlist
 * проверяется здесь, не на клиенте: без явного гранта switch невозможен
 * даже для admin. Никогда не трогает miranda_device_bindings.is_default —
 * временно только на текущей сессии. */
export type SwitchAccountResult = { ok: true } | { ok: false; error: 'account_not_found' } | { ok: false; error: 'not_granted' };

export async function switchSessionAccount(
  adminEmployeeId: number,
  adminOrgId: string,
  sessionToken: string,
  corporateAccountId: number
): Promise<SwitchAccountResult> {
  const account = await mirandaRepo.getCorporateAccount(corporateAccountId);
  if (!account || !account.is_active) return { ok: false, error: 'account_not_found' };

  const granted = await mirandaRepo.hasActiveGrant(adminEmployeeId, corporateAccountId);
  if (!granted) return { ok: false, error: 'not_granted' };

  await mirandaRepo.setActiveCorporateAccountForSession(hashToken(sessionToken), corporateAccountId);
  await auditRepo.record({
    orgId: adminOrgId,
    actorEmployeeId: adminEmployeeId,
    actorTelegramId: null,
    action: 'MIRANDA_ADMIN_ACCOUNT_SWITCH',
    targetType: 'corporate_account',
    targetId: String(corporateAccountId)
  });
  return { ok: true };
}

/** Admin Control Center — явное создание корпоративного аккаунта, не
 * привязанное к регистрации устройства (в отличие от registerDevice
 * выше). conflict означает, что для этой пары employeeId+storeId уже
 * есть ряд — UNIQUE(employee_id, store_id), админу нужно использовать
 * существующий аккаунт (listAllCorporateAccounts), не создавать дубль. */
export type CreateAccountResult = { ok: true; account: mirandaRepo.CorporateAccountRow } | { ok: false; error: 'conflict' };

export async function createCorporateAccount(
  orgId: string,
  employeeId: number,
  storeId: string | null,
  displayLabel: string | null,
  actorEmployeeId: number
): Promise<CreateAccountResult> {
  return withTransaction(async (q) => {
    const account = await mirandaRepo.createCorporateAccount(orgId, employeeId, storeId, displayLabel, q);
    if (!account) return { ok: false, error: 'conflict' };
    await auditRepo.record(
      {
        orgId,
        actorEmployeeId,
        actorTelegramId: null,
        action: 'MIRANDA_ACCOUNT_CREATED',
        targetType: 'corporate_account',
        targetId: String(account.id),
        after: { employeeId, storeId, displayLabel }
      },
      q
    );
    return { ok: true, account };
  });
}

/** Этап B (вариант B) — создание аккаунта точки/кассы с собственным
 * логином (телефон+пароль), без employee_id. conflict означает, что
 * телефон уже занят в этой сети — UNIQUE(org_id, phone), админу нужно
 * использовать другой телефон или существующий аккаунт. */
export type CreatePointAccountResult = { ok: true; account: mirandaRepo.CorporateAccountRow } | { ok: false; error: 'phone_conflict' };

export async function createPointCorporateAccount(
  orgId: string,
  phone: string,
  password: string,
  accountName: string,
  storeId: string | null,
  actorEmployeeId: number
): Promise<CreatePointAccountResult> {
  const passwordHash = await hashPassword(password);
  return withTransaction(async (q) => {
    const account = await mirandaRepo.createPointCorporateAccount(orgId, phone, passwordHash, accountName, storeId, q);
    if (!account) return { ok: false, error: 'phone_conflict' };
    await auditRepo.record(
      {
        orgId,
        actorEmployeeId,
        actorTelegramId: null,
        action: 'MIRANDA_ACCOUNT_CREATED',
        targetType: 'corporate_account',
        targetId: String(account.id),
        after: { accountName, storeId, kind: 'point' }
      },
      q
    );
    return { ok: true, account };
  });
}

export async function listPendingBindings(orgIds: string[]) {
  return mirandaRepo.listPendingBindings(orgIds);
}

export async function listAvailableAccountsForAdmin(adminEmployeeId: number, deviceSecret: string | null) {
  let deviceId: number | null = null;
  if (deviceSecret) {
    const device = await mirandaRepo.findDeviceBySecret(deviceSecret);
    deviceId = device?.id ?? null;
  }
  return mirandaRepo.listAvailableAccountsForAdmin(adminEmployeeId, deviceId);
}

/** online вычисляется здесь (не в репозитории — тот не должен импортировать
 * realtime-registry): presence_override выигрывает, если задан явно;
 * иначе — авто по живому WS-сокету мессенджера (§1 плана). */
export async function listAllCorporateAccounts(orgIds: string[], includeInactive = false) {
  const rows = await mirandaRepo.listAllCorporateAccounts(orgIds, includeInactive);
  return rows.map((row) => ({
    ...row,
    online:
      row.presence_override === 'online'
        ? true
        : row.presence_override === 'offline'
          ? false
          : connectionCountForAccount(row.corporate_account_id) > 0
  }));
}

/** §1 плана — ручное переключение своего статуса "в сети"/"не в сети",
 * или возврат к авто-режиму (status = null). Пишет только на свой же
 * corporateAccountId (из принципала, не из тела запроса, см. роут). */
export async function setPresence(
  corporateAccountId: number,
  status: 'online' | 'offline' | null,
  orgId: string
): Promise<void> {
  await mirandaRepo.setPresenceOverride(corporateAccountId, status);
  await auditRepo.record({
    orgId,
    actorEmployeeId: null,
    actorTelegramId: null,
    action: 'MIRANDA_PRESENCE_SET',
    targetType: 'corporate_account',
    targetId: String(corporateAccountId),
    after: { status }
  });
}

/** §2 плана — группы контактов, общие для всего дилера (настраивает
 * администратор любой сети дилера, см. requireAdmin на мутациях в
 * api/routes/miranda/contact-groups.ts). Чтение доступно всем принципалам
 * Miranda (сотрудник и точка) — скоупится на все org_id дилера. */
export async function listContactGroups(orgIds: string[]) {
  return contactGroupsRepo.listGroupsWithMembers(orgIds);
}

export type CreateContactGroupResult =
  | { ok: true; group: contactGroupsRepo.ContactGroupRow }
  | { ok: false; error: 'conflict' | 'not_found' };

/** §A плана — группы контактов администрируются глобально: любой admin
 * может создать/изменить группу в ЛЮБОЙ сети любого дилера (не обязан
 * принадлежать её дилеру), admin единый на всё приложение. Чтение
 * остаётся dealer-scoped для обычных сотрудников (listContactGroups/
 * GET /miranda/groups — не трогаем) — поэтому проверка дубля имени
 * (siblings) и containment родителя по-прежнему считаются по дилеру
 * ЦЕЛЕВОЙ сети (orgId), не по дилеру админа: иначе два одноимённых
 * корня могли бы попасть в один и тот же dealer-wide список, который
 * увидит сотрудник. */
export async function createContactGroup(
  orgId: string,
  name: string,
  parentGroupId: number | null,
  createdByEmployeeId: number | null
): Promise<CreateContactGroupResult> {
  return withTransaction(async (q) => {
    const dealerOrgIds = await resolveDealerOrgIds(orgId);
    if (parentGroupId !== null) {
      const parent = await contactGroupsRepo.getGroup(parentGroupId, q);
      if (!parent || !dealerOrgIds.includes(parent.org_id)) return { ok: false, error: 'not_found' };
    }
    const group = await contactGroupsRepo.createGroup(orgId, dealerOrgIds, name, parentGroupId, createdByEmployeeId, q);
    if (!group) return { ok: false, error: 'conflict' };
    await auditRepo.record(
      { orgId, actorEmployeeId: createdByEmployeeId, actorTelegramId: null, action: 'MIRANDA_CONTACT_GROUP_CREATED', targetType: 'miranda_contact_group', targetId: String(group.id), after: { name, parentGroupId } },
      q
    );
    return { ok: true, group };
  });
}

export type ContactGroupMutationResult = { ok: true } | { ok: false; error: 'not_found' | 'conflict' };

export async function renameContactGroup(groupId: number, name: string, orgId: string, actorEmployeeId: number | null): Promise<ContactGroupMutationResult> {
  return withTransaction(async (q) => {
    const existing = await contactGroupsRepo.getGroup(groupId, q);
    if (!existing) return { ok: false, error: 'not_found' };
    const updated = await contactGroupsRepo.renameGroup(groupId, name, q);
    if (!updated) return { ok: false, error: 'conflict' };
    await auditRepo.record(
      { orgId, actorEmployeeId, actorTelegramId: null, action: 'MIRANDA_CONTACT_GROUP_RENAMED', targetType: 'miranda_contact_group', targetId: String(groupId), before: { name: existing.name }, after: { name } },
      q
    );
    return { ok: true };
  });
}

export async function deleteContactGroup(groupId: number, orgId: string, actorEmployeeId: number | null): Promise<ContactGroupMutationResult> {
  return withTransaction(async (q) => {
    const existing = await contactGroupsRepo.getGroup(groupId, q);
    if (!existing) return { ok: false, error: 'not_found' };
    await contactGroupsRepo.deleteGroup(groupId, q);
    await auditRepo.record(
      { orgId, actorEmployeeId, actorTelegramId: null, action: 'MIRANDA_CONTACT_GROUP_DELETED', targetType: 'miranda_contact_group', targetId: String(groupId), before: { name: existing.name } },
      q
    );
    return { ok: true };
  });
}

/** Добавление контакта в группу — глобально (§A плана): админ может
 * добавить в группу контакт из ЛЮБОЙ сети, не обязательно дилера самой
 * группы — проверяется здесь только существование через
 * mirandaRepo.getCorporateAccount, не доверяем клиенту. */
export async function addContactToGroup(groupId: number, targetCorporateAccountId: number, orgId: string, actorEmployeeId: number | null): Promise<ContactGroupMutationResult> {
  return withTransaction(async (q) => {
    const existing = await contactGroupsRepo.getGroup(groupId, q);
    if (!existing) return { ok: false, error: 'not_found' };
    const target = await mirandaRepo.getCorporateAccount(targetCorporateAccountId);
    if (!target) return { ok: false, error: 'not_found' };
    await contactGroupsRepo.addMember(groupId, targetCorporateAccountId, q);
    await auditRepo.record(
      { orgId, actorEmployeeId, actorTelegramId: null, action: 'MIRANDA_CONTACT_GROUP_MEMBER_ADDED', targetType: 'miranda_contact_group', targetId: String(groupId), after: { targetCorporateAccountId } },
      q
    );
    return { ok: true };
  });
}

export async function removeContactFromGroup(groupId: number, targetCorporateAccountId: number, orgId: string, actorEmployeeId: number | null): Promise<ContactGroupMutationResult> {
  return withTransaction(async (q) => {
    const existing = await contactGroupsRepo.getGroup(groupId, q);
    if (!existing) return { ok: false, error: 'not_found' };
    await contactGroupsRepo.removeMember(groupId, targetCorporateAccountId, q);
    await auditRepo.record(
      { orgId, actorEmployeeId, actorTelegramId: null, action: 'MIRANDA_CONTACT_GROUP_MEMBER_REMOVED', targetType: 'miranda_contact_group', targetId: String(groupId), after: { targetCorporateAccountId } },
      q
    );
    return { ok: true };
  });
}

/** Поиск контактов для обычного пользователя мессенджера (не admin) — см.
 * mirandaRepo.searchCorporateAccounts. excludeCorporateAccountId убирает
 * собственный активный аккаунт запрашивающего из результатов. */
export async function searchCorporateAccounts(orgIds: string[], term: string, excludeCorporateAccountId: number | null) {
  return mirandaRepo.searchCorporateAccounts(orgIds, term, excludeCorporateAccountId);
}

export async function grantAdminAccount(adminEmployeeId: number, corporateAccountId: number, grantedByEmployeeId: number, orgId: string): Promise<void> {
  await withTransaction(async (q) => {
    await mirandaRepo.grantAdminAccount(adminEmployeeId, corporateAccountId, grantedByEmployeeId, q);
    await auditRepo.record(
      {
        orgId,
        actorEmployeeId: grantedByEmployeeId,
        actorTelegramId: null,
        action: 'MIRANDA_ADMIN_ACCOUNT_GRANTED',
        targetType: 'corporate_account',
        targetId: String(corporateAccountId),
        after: { adminEmployeeId }
      },
      q
    );
  });
}
