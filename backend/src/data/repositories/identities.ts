/**
 * Data Access Layer — identities (20.48.0, Web Security & Trust Layer,
 * Auth & Session Security). Единственный источник правды для auth-резолва
 * (auth/principal.ts::loadUser()) — не декоративная таблица поверх
 * employees.telegram_id/phone, которые остаются нетронутыми для
 * не-auth потребителей (бот-уведомления, отображение в Команде и т.д.).
 *
 * Две разные функции записи, не одна универсальная — разная семантика
 * конфликта по инварианту, зафиксированному владельцем продукта:
 *   - Telegram identity: ownership transfer (steal) разрешён — уже
 *     протестированный self-bind recovery-flow (employees.ts::claimTelegramId).
 *   - Phone identity: transfer НЕ разрешён — телефон это credential
 *     boundary, не recovery-механизм; конфликт с чужим номером — 409.
 */
import { query } from '../db/index.js';

export type IdentityProviderRow = 'telegram' | 'phone';

/**
 * Telegram-only. Освобождает слот (employee_id, provider) ДО INSERT, поэтому
 * ON CONFLICT по (provider, provider_key) (steal у ЧУЖОГО сотрудника) не
 * может напороться на собственный UNIQUE(employee_id, provider) — оба
 * constraint'а учтены одним упорядоченным statement-паром. При параллельных
 * transferIdentity на один provider_key Postgres сериализует их через
 * row-lock на DELETE/INSERT — результат детерминирован, не гонка.
 */
export async function transferIdentity(
  employeeId: number, provider: IdentityProviderRow, providerKey: string, q: typeof query = query
): Promise<void> {
  await q(`DELETE FROM identities WHERE employee_id=$1 AND provider=$2 AND provider_key<>$3`, [employeeId, provider, providerKey]);
  await q(
    `INSERT INTO identities (employee_id, provider, provider_key, updated_at)
     VALUES ($1,$2,$3,now())
     ON CONFLICT (provider, provider_key)
     DO UPDATE SET employee_id=EXCLUDED.employee_id, updated_at=now()`,
    [employeeId, provider, providerKey]
  );
}

/**
 * Phone-only. Тот же освобождающий DELETE (сотрудник переподвязывает СВОЙ
 * номер — разрешено), но БЕЗ ON CONFLICT — если provider_key уже занят
 * ДРУГИМ сотрудником, поднимается сырой 23505 (UNIQUE(provider,provider_key)),
 * который вызывающий код уже умеет ловить (me/index.ts::/me/link-phone
 * уже перехватывает e.code==='23505' → 409 phone_taken).
 */
export async function bindIdentityStrict(
  employeeId: number, provider: IdentityProviderRow, providerKey: string, q: typeof query = query
): Promise<void> {
  await q(`DELETE FROM identities WHERE employee_id=$1 AND provider=$2 AND provider_key<>$3`, [employeeId, provider, providerKey]);
  await q(
    `INSERT INTO identities (employee_id, provider, provider_key, updated_at) VALUES ($1,$2,$3,now())`,
    [employeeId, provider, providerKey]
  );
}

/** Деактивация сотрудника — снимает identity для указанного provider. */
export async function removeIdentity(employeeId: number, provider: IdentityProviderRow, q: typeof query = query): Promise<void> {
  await q(`DELETE FROM identities WHERE employee_id=$1 AND provider=$2`, [employeeId, provider]);
}

/** auth/principal.ts::loadUser() — резолв внешнего идентификатора в employee_id. */
export async function findEmployeeId(provider: IdentityProviderRow, providerKey: string): Promise<number | null> {
  const res = await query(`SELECT employee_id FROM identities WHERE provider=$1 AND provider_key=$2 LIMIT 1`, [provider, providerKey]);
  return res.rows[0]?.employee_id ?? null;
}
