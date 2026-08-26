/**
 * Data Access Layer (20.8.0, Full DAL) — весь SQL по таблице `employees`.
 * Часть функций здесь НЕ принимает orgId и не фильтрует по сети в самом
 * запросе (getRole/getIsActive/updateFields/softDeactivate/updateRole/
 * approveExisting/аватарки) — это не упущение, а точное сохранение
 * поведения роутов, которые уже сами проверяют принадлежность сети ДО
 * вызова этих функций через requireEmployeeInOrg-preHandler
 * (middleware-auth.ts, закрыто в 19.11.0). Добавлять сюда orgId-фильтр,
 * которого не было в исходном SQL, значило бы менять поведение под видом
 * переноса — этот файл только переносит существующий SQL, ничего не чинит.
 */
import { query } from '../db/index.js';

export interface EmployeeRow {
  id: number;
  full_name: string;
  short_name: string | null;
  role: string;
  is_active: boolean;
  telegram_id: number | string | null;
  org_id?: string;
}

export interface EmployeeAuthRow {
  employee_id: number;
  full_name: string | null;
  role: string;
  telegram_id: number | string;
  access_status: string | null;
  is_active: boolean;
  org_id: string | null;
}

export type EmployeePatch = Partial<{
  full_name: string;
  short_name: string;
  is_active: boolean;
}>;

const PATCHABLE_FIELDS = ['full_name', 'short_name', 'is_active'] as const;

/** Используется authPlugin/loadUser — резолв юзера по подтверждённому Telegram id. */
export async function findByTelegramId(telegramId: number): Promise<EmployeeAuthRow | null> {
  const res = await query(
    `SELECT id as employee_id, full_name, role, telegram_id, access_status, is_active, org_id
     FROM employees
     WHERE telegram_id = $1::bigint
     LIMIT 1`,
    [telegramId]
  );
  return res.rows[0] || null;
}

/** Не-Telegram вход (20.35, план) — используется authPlugin/loadUser для
 * phone-provider'а: сессия уже резолвила employee_id, здесь просто читаем
 * ту же форму строки, что findByTelegramId. */
export async function findById(employeeId: number): Promise<EmployeeAuthRow | null> {
  const res = await query(
    `SELECT id as employee_id, full_name, role, telegram_id, access_status, is_active, org_id
     FROM employees
     WHERE id = $1
     LIMIT 1`,
    [employeeId]
  );
  return res.rows[0] || null;
}

/** Не-Telegram вход (20.35, план) — резолв по телефону для /auth/login. */
export async function findByPhone(phone: string): Promise<
  { id: number; full_name: string; role: string; password_hash: string | null; is_active: boolean; access_status: string | null } | null
> {
  const res = await query(
    `SELECT id, full_name, role, password_hash, is_active, access_status
     FROM employees
     WHERE phone = $1
     LIMIT 1`,
    [phone]
  );
  return res.rows[0] || null;
}

/** Не-Telegram вход (20.35, план) — используется /auth/reset/:token (сброс
 * пароля) после успешного consumePasswordReset. */
export async function setPasswordHash(employeeId: number, passwordHash: string): Promise<void> {
  await query(`UPDATE employees SET password_hash = $1 WHERE id = $2`, [passwordHash, employeeId]);
}

/** Тот же чек, что storesRepo.belongsToOrg — используется requireEmployeeInOrg. */
export async function belongsToOrg(orgId: string, employeeId: number): Promise<boolean> {
  const res = await query(`SELECT COALESCE(org_id, 'default') as org_id FROM employees WHERE id = $1`, [employeeId]);
  return !!res.rows[0] && res.rows[0].org_id === orgId;
}

/** null, если сотрудника нет — вызывающий код (tenant.ts::orgIdForEmployee) сам подставляет 'default'. */
export async function getOrgId(employeeId: number): Promise<string | null> {
  const res = await query(`SELECT org_id FROM employees WHERE id = $1`, [employeeId]);
  return res.rows[0]?.org_id ?? null;
}

export async function getRole(employeeId: number): Promise<string | null> {
  const res = await query(`SELECT role FROM employees WHERE id = $1`, [employeeId]);
  return res.rows[0]?.role ?? null;
}

export async function getIsActive(employeeId: number): Promise<boolean | null> {
  const res = await query(`SELECT is_active FROM employees WHERE id = $1`, [employeeId]);
  return res.rows[0]?.is_active ?? null;
}

/** GET /employees/:id/profile — минимальная карточка для шапки профиля. */
export async function findBasicById(employeeId: number): Promise<{ id: number; full_name: string; short_name: string | null; role: string } | null> {
  const res = await query(`SELECT id, full_name, short_name, role FROM employees WHERE id = $1`, [employeeId]);
  return res.rows[0] || null;
}

/** services/plans.ts::getMonthSummaryTable — базовая проекция для сводной таблицы планов. */
export async function listBasicByOrg(orgId: string): Promise<{ id: number; full_name: string; short_name: string | null; role: string }[]> {
  const res = await query(
    `SELECT id, full_name, short_name, role FROM employees
     WHERE COALESCE(is_active, true) = true AND COALESCE(org_id, 'default') = $1
     ORDER BY full_name`,
    [orgId]
  );
  return res.rows;
}

/** POST /me/bind — карточка-цель уже привязана к кому-то другому? деактивирована? */
export async function findBindTarget(employeeId: number): Promise<{ telegram_id: number | string | null; is_active: boolean | null } | null> {
  const res = await query(`SELECT telegram_id, is_active FROM employees WHERE id = $1`, [employeeId]);
  return res.rows[0] || null;
}

/**
 * POST /me/bind — снять Telegram с любой другой карточки и привязать к
 * выбранной ОДНИМ атомарным выражением (WITH ... UPDATE), не двумя
 * отдельными автокоммитящимися запросами (как было до этой правки —
 * clearTelegramId()+bindTelegram()). Раньше между "снять" и "поставить"
 * было окно: при нескольких конкурентных /me/bind ОДНИМ и тем же
 * telegram_id на РАЗНЫЕ карточки чей-то уже совершившийся bind мог быть
 * стёрт чужим clearTelegramId(), выполнившимся ПОСЛЕ него, — тот запрос
 * уже успел отдать клиенту 200, хотя финальным владельцем становился
 * кто-то другой. Adversarial race-тест (5 параллельных bind) поймал это
 * эмпирически: за один прогон могло быть больше одного 200, не только
 * при столкновении на одной и той же карточке — employees_telegram_id_unique
 * (0002) сам по себе не спасал, потому что конфликта на УРОВНЕ ЗНАЧЕНИЯ
 * в момент каждого отдельного bindTelegram() могло и не быть: он всегда
 * успевал сработать на СВОБОДНОЙ в этот момент карточке. Один CTE делает
 * "снять отовсюду + поставить сюда" неделимой операцией — ни одна
 * конкурентная транзакция больше не может встрять между этими двумя
 * шагами, и UNIQUE-конфликт остаётся единственным источником "кто
 * победил", как и было задумано изначально.
 */
export async function claimTelegramId(telegramId: number, employeeId: number): Promise<any | null> {
  const res = await query(
    `WITH cleared AS (
       UPDATE employees SET telegram_id = NULL WHERE telegram_id = $1
     )
     UPDATE employees
     SET telegram_id = $1,
         access_status = COALESCE(NULLIF(access_status, ''), 'active'),
         is_active = true
     WHERE id = $2
     RETURNING id as employee_id, id, full_name, short_name, role, telegram_id, access_status`,
    [telegramId, employeeId]
  );
  return res.rows[0] || null;
}

/** GET /me/day — своя карточка, активна ли (та же identity, что и request.user, лишний раз сверяем). */
export async function findBasicActive(employeeId: number): Promise<{ id: number; full_name: string; short_name: string | null; role: string; telegram_id: number | string | null } | null> {
  const res = await query(
    `SELECT id, full_name, short_name, role, telegram_id
     FROM employees
     WHERE id = $1 AND COALESCE(is_active, true) = true
     LIMIT 1`,
    [employeeId]
  );
  return res.rows[0] || null;
}

/** GET /employees — canSeeTelegramId управляет наличием колонки telegram_id в выборке. */
export async function listActiveByOrg(orgId: string, includeTelegramId: boolean): Promise<EmployeeRow[]> {
  const res = await query(
    `SELECT id, full_name, short_name, ${includeTelegramId ? 'telegram_id,' : ''} is_active, role
     FROM employees
     WHERE is_active = true AND COALESCE(org_id, 'default') = $1
     ORDER BY id`,
    [orgId]
  );
  return res.rows;
}

export async function createEmployee(
  fullName: string, shortName: string, role: string, orgId: string
): Promise<EmployeeRow> {
  const res = await query(
    `INSERT INTO employees (full_name, short_name, role, is_active, org_id)
     VALUES ($1, $2, $3, true, $4)
     RETURNING id, full_name, short_name, role, is_active, telegram_id, org_id`,
    [fullName, shortName, role, orgId]
  );
  return res.rows[0];
}

/** PATCH /employees/:id — тот же динамический SET, что stores.ts::update, без orgId-фильтра (см. заголовок файла). */
export async function updateFields(
  employeeId: number, patch: EmployeePatch, q: typeof query = query
): Promise<EmployeeRow | null> {
  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;
  for (const key of PATCHABLE_FIELDS) {
    if (patch[key] !== undefined) {
      sets.push(`${key} = $${i++}`);
      vals.push(patch[key]);
    }
  }
  if (!sets.length) return null;
  vals.push(employeeId);
  const res = await q(
    `UPDATE employees SET ${sets.join(', ')} WHERE id = $${i}
     RETURNING id, full_name, short_name, role, is_active, telegram_id`,
    vals
  );
  return res.rows[0] || null;
}

/** DELETE /employees/:id — soft delete, отвязывает telegram, не трогает историю. */
export async function softDeactivate(
  employeeId: number, q: typeof query = query
): Promise<{ id: number; full_name: string; is_active: boolean } | null> {
  const res = await q(
    `UPDATE employees SET is_active = false, telegram_id = NULL WHERE id = $1
     RETURNING id, full_name, is_active`,
    [employeeId]
  );
  return res.rows[0] || null;
}

export async function updateRole(
  employeeId: number, role: string, q: typeof query = query
): Promise<{ id: number; full_name: string; role: string } | null> {
  const res = await q(`UPDATE employees SET role = $1 WHERE id = $2 RETURNING id, full_name, role`, [role, employeeId]);
  return res.rows[0] || null;
}

/** /access/employees-directory — «я вот этот» пикер незарегистрированного гостя. */
export async function findUnclaimedDirectory(orgId?: string): Promise<{ id: number; full_name: string }[]> {
  const params: any[] = [];
  let orgFilter = '';
  if (orgId) {
    params.push(orgId);
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
}

/** Кому слать уведомление о новой заявке на доступ: admin всей системы + manager/supervisor/senior этой сети. */
export async function findManagersToNotify(orgId: string): Promise<{ telegram_id: string; full_name: string }[]> {
  const res = await query(
    `SELECT telegram_id, full_name FROM employees
     WHERE telegram_id IS NOT NULL AND access_status = 'active'
       AND ( role = 'admin'
             OR (role IN ('manager','supervisor','senior') AND COALESCE(org_id,'default') = $1) )`,
    [orgId]
  );
  return res.rows;
}

/** Approve заявки на существующую (claimed) карточку сотрудника. */
export async function approveExisting(
  employeeId: number, telegramId: string | number, role: string | null, verifiedBy: number | null, fullNameFallback: string,
  q: typeof query = query
): Promise<void> {
  await q(
    `UPDATE employees SET
       telegram_id = $1,
       access_status = 'active',
       role = COALESCE($2, role),
       verified_by = $3,
       verified_at = now(),
       full_name = COALESCE(full_name, $4)
     WHERE id = $5`,
    [telegramId, role, verifiedBy, fullNameFallback, employeeId]
  );
}

/** Approve заявки без claim — заводит нового сотрудника в сети заявки. */
export async function createFromApproval(
  fullName: string, telegramId: string | number, role: string, verifiedBy: number | null, orgId: string,
  q: typeof query = query
): Promise<number> {
  const res = await q(
    `INSERT INTO employees (full_name, telegram_id, role, access_status, is_active, verified_by, verified_at, org_id)
     VALUES ($1,$2,$3,'active',true,$4,now(),$5)
     RETURNING id`,
    [fullName, telegramId, role, verifiedBy, orgId]
  );
  return res.rows[0]?.id;
}

/** Не-Telegram вход (20.35, план) — approveExisting/createFromApproval для
 * заявок с provider='phone', отдельные функции, не ветвление внутри
 * существующих: сигнатуры принципиально разные (телефон+пароль вместо
 * telegram_id), Telegram-путь не трогаем даже branch'ем внутри. */
export async function approveExistingPhone(
  employeeId: number, phone: string, passwordHash: string, role: string | null, verifiedBy: number | null, fullNameFallback: string,
  q: typeof query = query
): Promise<void> {
  await q(
    `UPDATE employees SET
       phone = $1,
       password_hash = $2,
       access_status = 'active',
       role = COALESCE($3, role),
       verified_by = $4,
       verified_at = now(),
       full_name = COALESCE(full_name, $5)
     WHERE id = $6`,
    [phone, passwordHash, role, verifiedBy, fullNameFallback, employeeId]
  );
}

export async function createFromApprovalPhone(
  fullName: string, phone: string, passwordHash: string, role: string, verifiedBy: number | null, orgId: string,
  q: typeof query = query
): Promise<number> {
  const res = await q(
    `INSERT INTO employees (full_name, phone, password_hash, role, access_status, is_active, verified_by, verified_at, org_id)
     VALUES ($1,$2,$3,$4,'active',true,$5,now(),$6)
     RETURNING id`,
    [fullName, phone, passwordHash, role, verifiedBy, orgId]
  );
  return res.rows[0]?.id;
}

/** Для уведомлений в бота (задачи/подтверждение и т.п.) — только telegram_id + имя. */
export async function getContactInfo(employeeId: number): Promise<{ telegram_id: string | number | null; full_name: string } | null> {
  const res = await query(`SELECT telegram_id, full_name FROM employees WHERE id = $1`, [employeeId]);
  return res.rows[0] || null;
}

export async function setAvatar(employeeId: number, data: Buffer, mime: string): Promise<void> {
  await query(`UPDATE employees SET avatar_data = $1, avatar_mime = $2 WHERE id = $3`, [data, mime, employeeId]);
}

export async function getAvatar(employeeId: number): Promise<{ avatar_data: Buffer | null; avatar_mime: string | null } | null> {
  const res = await query(`SELECT avatar_data, avatar_mime FROM employees WHERE id = $1`, [employeeId]);
  return res.rows[0] || null;
}
