/**
 * Data Access Layer — T2 Miranda, этап 1 (Этап A плана): корпоративные
 * аккаунты, устройства, привязки устройство↔аккаунт, admin-гранты на
 * временное переключение. SQL — см. migrations/0039_miranda_accounts.sql.
 *
 * q — последний параметр, по умолчанию глобальный query() (тот же приём,
 * что у всех репозиториев с 20.8.0) — чтобы register/approve/switch могли
 * участвовать в withTransaction() там, где нужна атомарность нескольких
 * записей разом.
 */
import { randomBytes, createHash } from 'crypto';
import { query } from '../db/index.js';

export function generateDeviceSecret(): string {
  return randomBytes(32).toString('hex');
}

export function hashDeviceSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export interface CorporateAccountRow {
  id: number;
  org_id: string;
  employee_id: number | null;
  store_id: string | null;
  display_label: string | null;
  is_active: boolean;
  device_exclusive: boolean;
  /** Этап B (вариант B) — только для точечных аккаунтов (employee_id NULL). */
  phone: string | null;
  account_name: string | null;
}

const CORPORATE_ACCOUNT_COLUMNS = 'id, org_id, employee_id, store_id, display_label, is_active, device_exclusive, phone, account_name';

/** employee_id + store_id — UNIQUE, поэтому "найти или создать" безопасно
 * делать как findOrInsert, не придумывая отдельный upsert-конфликт-хендлер
 * ради одной редко вызываемой операции (регистрация устройства). */
export async function findOrCreateCorporateAccount(
  orgId: string,
  employeeId: number,
  storeId: string | null,
  displayLabel: string | null,
  q: typeof query = query
): Promise<CorporateAccountRow> {
  const existing = await q(
    `SELECT ${CORPORATE_ACCOUNT_COLUMNS}
     FROM corporate_accounts WHERE employee_id = $1 AND store_id IS NOT DISTINCT FROM $2`,
    [employeeId, storeId]
  );
  if (existing.rows[0]) return existing.rows[0];
  const inserted = await q(
    `INSERT INTO corporate_accounts (org_id, employee_id, store_id, display_label)
     VALUES ($1, $2, $3, $4)
     RETURNING ${CORPORATE_ACCOUNT_COLUMNS}`,
    [orgId, employeeId, storeId, displayLabel]
  );
  return inserted.rows[0];
}

/** Admin Control Center — явное создание корпоративного аккаунта (в
 * отличие от findOrCreateCorporateAccount выше, который только
 * побочный эффект регистрации устройства). UNIQUE(employee_id, store_id)
 * здесь не "найти или создать" — повтор для уже занятой пары возвращает
 * null, чтобы роут вернул осознанный конфликт, а не тихо подсунул чужой
 * существующий ряд под видом "созданного". */
export async function createCorporateAccount(
  orgId: string,
  employeeId: number,
  storeId: string | null,
  displayLabel: string | null,
  q: typeof query = query
): Promise<CorporateAccountRow | null> {
  const res = await q(
    `INSERT INTO corporate_accounts (org_id, employee_id, store_id, display_label)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (employee_id, store_id) DO NOTHING
     RETURNING ${CORPORATE_ACCOUNT_COLUMNS}`,
    [orgId, employeeId, storeId, displayLabel]
  );
  return res.rows[0] || null;
}

/** Этап B (вариант B) — создание аккаунта точки/кассы: собственный вход
 * (телефон+пароль), без employee_id. UNIQUE(org_id, phone) — повтор для
 * занятого телефона в той же сети возвращает null (409 на уровне роута),
 * тот же принцип, что createCorporateAccount выше для employee_id+storeId. */
export async function createPointCorporateAccount(
  orgId: string,
  phone: string,
  passwordHash: string,
  accountName: string,
  storeId: string | null,
  q: typeof query = query
): Promise<CorporateAccountRow | null> {
  const res = await q(
    `INSERT INTO corporate_accounts (org_id, phone, password_hash, account_name, store_id, display_label)
     VALUES ($1, $2, $3, $4, $5, $4)
     ON CONFLICT (org_id, phone) WHERE phone IS NOT NULL DO NOTHING
     RETURNING ${CORPORATE_ACCOUNT_COLUMNS}`,
    [orgId, phone, passwordHash, accountName, storeId]
  );
  return res.rows[0] || null;
}

export interface PointAccountWithPassword extends CorporateAccountRow {
  password_hash: string | null;
}

/** Логин точки не знает org_id заранее (только телефон+пароль) —
 * UNIQUE(org_id, phone) гарантирует не больше одного совпадения даже без
 * org-фильтра, так что поиск по всем сетям не открывает межсетевой доступ. */
export async function findPointAccountByAnyOrgPhone(phone: string): Promise<PointAccountWithPassword | null> {
  const res = await query(
    `SELECT ${CORPORATE_ACCOUNT_COLUMNS}, password_hash FROM corporate_accounts
     WHERE phone = $1 AND employee_id IS NULL`,
    [phone]
  );
  return res.rows[0] || null;
}

export async function getCorporateAccount(id: number): Promise<CorporateAccountRow | null> {
  const res = await query(
    `SELECT ${CORPORATE_ACCOUNT_COLUMNS} FROM corporate_accounts WHERE id = $1`,
    [id]
  );
  return res.rows[0] || null;
}

/** Админ-переключатель "этот аккаунт — точки/кассы, должен быть привязан
 * ровно к одному активному устройству за раз" (личные аккаунты сотрудника
 * остаются device_exclusive=false и могут работать с нескольких устройств
 * одновременно — см. approveBinding в core/miranda-accounts/service.ts,
 * где это реально проверяется). */
export async function setCorporateAccountDeviceExclusive(
  id: number,
  deviceExclusive: boolean,
  q: typeof query = query
): Promise<CorporateAccountRow | null> {
  const res = await q(
    `UPDATE corporate_accounts SET device_exclusive = $2 WHERE id = $1
     RETURNING ${CORPORATE_ACCOUNT_COLUMNS}`,
    [id, deviceExclusive]
  );
  return res.rows[0] || null;
}

/** Есть ли у этого корпоративного аккаунта уже активная привязка к ДРУГОМУ
 * устройству — проверяется только для device_exclusive=true аккаунтов
 * перед approve (см. core/miranda-accounts/service.ts). */
export async function hasOtherActiveBinding(
  corporateAccountId: number,
  excludeDeviceId: number,
  q: typeof query = query
): Promise<boolean> {
  const res = await q(
    `SELECT 1 FROM miranda_device_bindings
     WHERE corporate_account_id = $1 AND device_id <> $2 AND status = 'active'
     LIMIT 1`,
    [corporateAccountId, excludeDeviceId]
  );
  return res.rows.length > 0;
}

export interface MirandaDeviceRow {
  id: number;
  device_secret_hash: string;
  platform: 'windows' | 'android';
  label: string | null;
  status: 'pending' | 'active' | 'revoked';
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

export async function findDeviceBySecret(secret: string): Promise<MirandaDeviceRow | null> {
  const res = await query(`SELECT * FROM miranda_devices WHERE device_secret_hash = $1`, [hashDeviceSecret(secret)]);
  return res.rows[0] || null;
}

export async function createDevice(
  secret: string,
  platform: 'windows' | 'android',
  label: string | null,
  q: typeof query = query
): Promise<MirandaDeviceRow> {
  const res = await q(
    `INSERT INTO miranda_devices (device_secret_hash, platform, label) VALUES ($1, $2, $3) RETURNING *`,
    [hashDeviceSecret(secret), platform, label]
  );
  return res.rows[0];
}

export async function touchDeviceLastSeen(deviceId: number): Promise<void> {
  await query(`UPDATE miranda_devices SET last_seen_at = now() WHERE id = $1`, [deviceId]);
}

export async function revokeDevice(deviceId: number, q: typeof query = query): Promise<void> {
  await q(`UPDATE miranda_devices SET status = 'revoked', revoked_at = now() WHERE id = $1`, [deviceId]);
  await q(
    `UPDATE miranda_device_bindings SET status = 'revoked', revoked_at = now()
     WHERE device_id = $1 AND status <> 'revoked'`,
    [deviceId]
  );
}

export interface MirandaDeviceBindingRow {
  id: number;
  device_id: number;
  corporate_account_id: number;
  is_default: boolean;
  status: 'pending' | 'active' | 'revoked';
  approved_by_employee_id: number | null;
  approved_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

export async function createBinding(
  deviceId: number,
  corporateAccountId: number,
  q: typeof query = query
): Promise<MirandaDeviceBindingRow> {
  const res = await q(
    `INSERT INTO miranda_device_bindings (device_id, corporate_account_id) VALUES ($1, $2) RETURNING *`,
    [deviceId, corporateAccountId]
  );
  return res.rows[0];
}

/** Активная привязка ЭТОГО устройства на ЭТОГО сотрудника — используется
 * при каждой активации (3.3 плана): ни наличие локального секрета, ни
 * сам факт его совпадения с хэшем сами по себе не дают доступ, только
 * текущий статус привязки, перечитанный с сервера на каждый запрос. */
export async function findActiveBindingForEmployee(deviceId: number, employeeId: number): Promise<MirandaDeviceBindingRow | null> {
  const res = await query(
    `SELECT b.* FROM miranda_device_bindings b
     JOIN corporate_accounts ca ON ca.id = b.corporate_account_id
     WHERE b.device_id = $1 AND ca.employee_id = $2 AND b.status = 'active'
     ORDER BY b.is_default DESC, b.id ASC
     LIMIT 1`,
    [deviceId, employeeId]
  );
  return res.rows[0] || null;
}

export async function findPendingBindingForEmployee(deviceId: number, employeeId: number): Promise<MirandaDeviceBindingRow | null> {
  const res = await query(
    `SELECT b.* FROM miranda_device_bindings b
     JOIN corporate_accounts ca ON ca.id = b.corporate_account_id
     WHERE b.device_id = $1 AND ca.employee_id = $2 AND b.status = 'pending'
     ORDER BY b.id ASC
     LIMIT 1`,
    [deviceId, employeeId]
  );
  return res.rows[0] || null;
}

export async function getBinding(id: number): Promise<MirandaDeviceBindingRow | null> {
  const res = await query(`SELECT * FROM miranda_device_bindings WHERE id = $1`, [id]);
  return res.rows[0] || null;
}

export interface PendingBindingListItem {
  binding_id: number;
  device_id: number;
  platform: 'windows' | 'android';
  device_label: string | null;
  corporate_account_id: number;
  employee_id: number;
  employee_full_name: string;
  store_id: string | null;
  created_at: string;
}

/** Admin Control Center — "Устройства Miranda", список ожидающих approve. */
export async function listPendingBindings(): Promise<PendingBindingListItem[]> {
  const res = await query(
    `SELECT b.id AS binding_id, b.device_id, d.platform, d.label AS device_label,
            b.corporate_account_id, ca.employee_id, e.full_name AS employee_full_name,
            ca.store_id, b.created_at
     FROM miranda_device_bindings b
     JOIN miranda_devices d ON d.id = b.device_id
     JOIN corporate_accounts ca ON ca.id = b.corporate_account_id
     JOIN employees e ON e.id = ca.employee_id
     WHERE b.status = 'pending'
     ORDER BY b.created_at ASC`
  );
  return res.rows;
}

export async function approveBinding(bindingId: number, approvedByEmployeeId: number, q: typeof query = query): Promise<MirandaDeviceBindingRow | null> {
  const res = await q(
    `UPDATE miranda_device_bindings
     SET status = 'active', approved_by_employee_id = $2, approved_at = now()
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [bindingId, approvedByEmployeeId]
  );
  return res.rows[0] || null;
}

export async function revokeBinding(bindingId: number, q: typeof query = query): Promise<MirandaDeviceBindingRow | null> {
  const res = await q(
    `UPDATE miranda_device_bindings SET status = 'revoked', revoked_at = now()
     WHERE id = $1 AND status <> 'revoked'
     RETURNING *`,
    [bindingId]
  );
  return res.rows[0] || null;
}

/** §3.5 плана — явный allowlist, без ряда здесь переключение недоступно
 * даже для admin. revoked_at IS NULL — отозванный грант не действует, не
 * удаляется (аудит прошлого гранта остаётся читаемым). */
export async function hasActiveGrant(adminEmployeeId: number, corporateAccountId: number): Promise<boolean> {
  const res = await query(
    `SELECT 1 FROM miranda_admin_account_grants
     WHERE admin_employee_id = $1 AND corporate_account_id = $2 AND revoked_at IS NULL`,
    [adminEmployeeId, corporateAccountId]
  );
  return res.rows.length > 0;
}

export interface AvailableAccountRow {
  corporate_account_id: number;
  employee_id: number;
  employee_full_name: string;
  store_id: string | null;
  display_label: string | null;
  is_default_for_device: boolean;
}

/** GET /miranda/accounts/available — аккаунты, явно разрешённые этому
 * админу (грант), с отметкой, какой из них сейчас default для deviceId. */
export async function listAvailableAccountsForAdmin(adminEmployeeId: number, deviceId: number | null): Promise<AvailableAccountRow[]> {
  const res = await query(
    `SELECT ca.id AS corporate_account_id, ca.employee_id, e.full_name AS employee_full_name,
            ca.store_id, ca.display_label,
            EXISTS (
              SELECT 1 FROM miranda_device_bindings b
              WHERE b.device_id = $2 AND b.corporate_account_id = ca.id AND b.is_default AND b.status = 'active'
            ) AS is_default_for_device
     FROM miranda_admin_account_grants g
     JOIN corporate_accounts ca ON ca.id = g.corporate_account_id
     JOIN employees e ON e.id = ca.employee_id
     WHERE g.admin_employee_id = $1 AND g.revoked_at IS NULL AND ca.is_active
     ORDER BY ca.id ASC`,
    [adminEmployeeId, deviceId]
  );
  return res.rows;
}

export interface CorporateAccountListItem {
  corporate_account_id: number;
  employee_id: number | null;
  employee_full_name: string;
  store_id: string | null;
  display_label: string | null;
  device_exclusive: boolean;
}

/** GET /miranda/accounts — весь список активных корпоративных аккаунтов
 * сети, для UI выдачи гранта (Admin Control Center, "Устройства Miranda") —
 * без этого у админа нет способа узнать corporateAccountId аккаунта,
 * чьё устройство уже одобрено (listPendingBindings его больше не содержит).
 * LEFT JOIN employees — аккаунт точки (Этап B) не имеет employee_id,
 * employee_full_name в этом случае падает на ca.account_name. */
export async function listAllCorporateAccounts(orgId: string): Promise<CorporateAccountListItem[]> {
  const res = await query(
    `SELECT ca.id AS corporate_account_id, ca.employee_id,
            COALESCE(e.full_name, ca.account_name) AS employee_full_name,
            ca.store_id, ca.display_label, ca.device_exclusive
     FROM corporate_accounts ca
     LEFT JOIN employees e ON e.id = ca.employee_id
     WHERE ca.org_id = $1 AND ca.is_active
     ORDER BY ca.id ASC`,
    [orgId]
  );
  return res.rows;
}

/**
 * Поиск контактов для обычного (не-admin) сотрудника, чтобы начать
 * диалог (§4 плана: список контактов строится по corporate_accounts, не
 * по employees напрямую). В отличие от listAllCorporateAccounts (admin-
 * only, весь список сети) — здесь всегда требуется непустой term (как у
 * /admin/search, минимум 2 символа проверяется в роуте) и исключается
 * собственный аккаунт запрашивающего.
 */
export async function searchCorporateAccounts(
  orgId: string,
  term: string,
  excludeCorporateAccountId: number | null
): Promise<CorporateAccountListItem[]> {
  const res = await query(
    `SELECT ca.id AS corporate_account_id, ca.employee_id,
            COALESCE(e.full_name, ca.account_name) AS employee_full_name,
            ca.store_id, ca.display_label
     FROM corporate_accounts ca
     LEFT JOIN employees e ON e.id = ca.employee_id
     WHERE ca.org_id = $1 AND ca.is_active
       AND COALESCE(e.full_name, ca.account_name) ILIKE '%' || $2 || '%'
       AND ($3::bigint IS NULL OR ca.id != $3)
     ORDER BY COALESCE(e.full_name, ca.account_name) ASC
     LIMIT 20`,
    [orgId, term, excludeCorporateAccountId]
  );
  return res.rows;
}

export async function grantAdminAccount(
  adminEmployeeId: number,
  corporateAccountId: number,
  grantedByEmployeeId: number,
  q: typeof query = query
): Promise<void> {
  await q(
    `INSERT INTO miranda_admin_account_grants (admin_employee_id, corporate_account_id, granted_by_employee_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (admin_employee_id, corporate_account_id) DO UPDATE SET revoked_at = NULL, granted_by_employee_id = $3, granted_at = now()`,
    [adminEmployeeId, corporateAccountId, grantedByEmployeeId]
  );
}

export async function revokeAdminAccountGrant(adminEmployeeId: number, corporateAccountId: number, q: typeof query = query): Promise<void> {
  await q(
    `UPDATE miranda_admin_account_grants SET revoked_at = now()
     WHERE admin_employee_id = $1 AND corporate_account_id = $2 AND revoked_at IS NULL`,
    [adminEmployeeId, corporateAccountId]
  );
}

/** §3.3/3.4 плана — активация на текущей сессии (обычный автологин ИЛИ
 * admin-переключение, оба пишут в то же поле employee_sessions). */
export async function setActiveCorporateAccountForSession(sessionTokenHash: string, corporateAccountId: number | null): Promise<void> {
  await query(`UPDATE employee_sessions SET active_corporate_account_id = $2 WHERE token_hash = $1`, [sessionTokenHash, corporateAccountId]);
}

/** Мессенджер (этап 2 плана) — на каждый чувствительный запрос сервер
 * заново читает, какой корпоративный аккаунт активен на ЭТОЙ сессии
 * прямо сейчас (не кэш клиента, см. §3.3 плана) — участник диалога это
 * значение, а не employee_id сессии напрямую. */
export async function getActiveCorporateAccountForSession(sessionTokenHash: string): Promise<number | null> {
  const res = await query(`SELECT active_corporate_account_id FROM employee_sessions WHERE token_hash = $1`, [sessionTokenHash]);
  const value = res.rows[0]?.active_corporate_account_id;
  return value === null || value === undefined ? null : Number(value);
}
