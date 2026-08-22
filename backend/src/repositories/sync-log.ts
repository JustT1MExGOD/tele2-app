/**
 * Data Access Layer (20.8.0, Full DAL) — SQL по таблице `offline_sync_log`.
 * Перенесено дословно из services/sales-write.ts::claimIdempotencyKey —
 * буквальный cut-paste, без рефакторинга (см. план 20.8.0, самый
 * рискованный кусок этой миграции).
 */
import { query } from '../db/index.js';

/**
 * true — ключ свежий, можно применять; false — уже был применён раньше
 * (тот же offline_sync_log/client_id, что и в /sync/batch — теперь
 * доступен и /sales, и /sales/quick: повторный тап "Добавить" или сетевой
 * ретрай с тем же client_id больше не удваивает сумму).
 */
export async function claimIdempotencyKey(
  key: string,
  employeeId: number,
  telegramId: number | null,
  payload: unknown,
  q: typeof query = query
): Promise<boolean> {
  const res = await q(
    `INSERT INTO offline_sync_log (client_id, employee_id, telegram_id, payload, status)
     VALUES ($1, $2, $3, $4, 'applied')
     ON CONFLICT (client_id) DO NOTHING
     RETURNING id`,
    [key, employeeId, telegramId, JSON.stringify(payload)]
  );
  return !!res.rows[0];
}
