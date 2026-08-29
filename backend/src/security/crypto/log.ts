/**
 * §29 — отдельный pino-инстанс для этого слоя, тот же приём, что уже
 * `cron/job-logger.ts` (не request-scoped код, не имеет доступа к
 * `app.log`). Используется репозиториями, которые вызывают
 * `decryptField()`, чтобы залогировать САМ ФАКТ неудачной расшифровки
 * (для ops — сигнал «ключ не тот» или «строка повреждена») без единого
 * секретного байта в сообщении: `logDecryptFailure()` принимает только
 * `err.name` (класс ошибки — DecryptionError/UnknownKeyVersionError/…),
 * никогда `err.message`, тем более сам конверт/plaintext/ключ.
 */
import pino from 'pino';

export const cryptoLogger = pino({ name: 'crypto' });

export function logDecryptFailure(context: { table: string; id: number | string }, err: unknown): void {
  const errorClass = err instanceof Error ? err.name : 'UnknownError';
  cryptoLogger.warn({ table: context.table, id: context.id, errorClass }, 'envelope decrypt failed');
}
