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
import { hashToken } from '../../data/repositories/sessions.js';
import * as auditRepo from '../../data/repositories/audit.js';

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
    const binding = await mirandaRepo.createBinding(device.id, account.id, q);
    await auditRepo.record(
      {
        orgId,
        actorEmployeeId: employeeId,
        actorTelegramId: null,
        action: 'MIRANDA_DEVICE_REGISTERED',
        targetType: 'miranda_device',
        targetId: String(device.id),
        after: { platform, corporateAccountId: account.id, bindingId: binding.id }
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

export async function listPendingBindings() {
  return mirandaRepo.listPendingBindings();
}

export async function listAvailableAccountsForAdmin(adminEmployeeId: number, deviceSecret: string | null) {
  let deviceId: number | null = null;
  if (deviceSecret) {
    const device = await mirandaRepo.findDeviceBySecret(deviceSecret);
    deviceId = device?.id ?? null;
  }
  return mirandaRepo.listAvailableAccountsForAdmin(adminEmployeeId, deviceId);
}

export async function listAllCorporateAccounts(orgId: string) {
  return mirandaRepo.listAllCorporateAccounts(orgId);
}

/** Поиск контактов для обычного пользователя мессенджера (не admin) — см.
 * mirandaRepo.searchCorporateAccounts. excludeCorporateAccountId убирает
 * собственный активный аккаунт запрашивающего из результатов. */
export async function searchCorporateAccounts(orgId: string, term: string, excludeCorporateAccountId: number | null) {
  return mirandaRepo.searchCorporateAccounts(orgId, term, excludeCorporateAccountId);
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
