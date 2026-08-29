/**
 * §4/§8/§38 — Master/KEK живёт вне PostgreSQL, приходит из окружения,
 * версионирован. `EnvKeyProvider` — единственная реализация сегодня;
 * `KeyProvider` остаётся интерфейсом специально, чтобы завтра подключить
 * внешний key management service (Railway пока не даёт встроенного KMS)
 * без изменения кода, который его вызывает (envelope.ts/keyring.ts).
 *
 * Формат окружения:
 *   DATA_ENCRYPTION_ENABLED=true            — feature flag (§38), по
 *                                              умолчанию выключено
 *   ENCRYPTION_ACTIVE_KEY_VERSION=2026-01   — версия KEK для НОВЫХ записей
 *   ENCRYPTION_KEKS={"2026-01":"<base64 32 байта>", ...}
 *                                            — все известные версии KEK,
 *                                              включая уже неактивные
 *                                              (нужны, чтобы читать старые
 *                                              конверты после rotation)
 *
 * Читается заново на каждый вызов (не кэшируется модульной переменной) —
 * так тесты могут переключать `process.env` за пределами обычного
 * жизненного цикла процесса, тем же приёмом, что уже используют другие
 * env-gated фичи проекта (ALLOW_INSECURE_AUTH, GROQ_API_KEY).
 */
import { CryptoConfigError } from './errors.js';
import { AES_256_KEY_LENGTH } from './random.js';
import type { KeyProvider, VersionedKey } from './types.js';

export function isEncryptionEnabled(): boolean {
  return process.env.DATA_ENCRYPTION_ENABLED === 'true';
}

function parseKeks(): Record<string, Buffer> {
  const raw = process.env.ENCRYPTION_KEKS;
  if (!raw) {
    throw new CryptoConfigError('ENCRYPTION_KEKS is not set but DATA_ENCRYPTION_ENABLED=true');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CryptoConfigError('ENCRYPTION_KEKS is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CryptoConfigError('ENCRYPTION_KEKS must be a JSON object of {version: base64Key}');
  }
  const out: Record<string, Buffer> = {};
  for (const [version, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      throw new CryptoConfigError(`ENCRYPTION_KEKS["${version}"] must be a base64 string`);
    }
    let key: Buffer;
    try {
      key = Buffer.from(value, 'base64');
    } catch {
      throw new CryptoConfigError(`ENCRYPTION_KEKS["${version}"] is not valid base64`);
    }
    if (key.length !== AES_256_KEY_LENGTH) {
      throw new CryptoConfigError(
        `ENCRYPTION_KEKS["${version}"] must decode to ${AES_256_KEY_LENGTH} bytes, got ${key.length}`
      );
    }
    out[version] = key;
  }
  if (Object.keys(out).length === 0) {
    throw new CryptoConfigError('ENCRYPTION_KEKS must contain at least one key');
  }
  return out;
}

/**
 * Валидация всей конфигурации без создания provider'а — используется
 * production-гвардом в `index.ts` (§8/§38: тихая деградация в plaintext
 * при сломанном конфиге недопустима, лучше не стартовать вообще, тот же
 * принцип, что уже применён к BOT_TOKEN).
 */
export function assertEncryptionConfigValid(): void {
  if (!isEncryptionEnabled()) return;
  const keks = parseKeks();
  const active = process.env.ENCRYPTION_ACTIVE_KEY_VERSION;
  if (!active) {
    throw new CryptoConfigError('ENCRYPTION_ACTIVE_KEY_VERSION is not set but DATA_ENCRYPTION_ENABLED=true');
  }
  if (!keks[active]) {
    throw new CryptoConfigError(
      `ENCRYPTION_ACTIVE_KEY_VERSION="${active}" has no matching entry in ENCRYPTION_KEKS`
    );
  }
}

export function createEnvKeyProvider(): KeyProvider {
  const keks = parseKeks();
  const activeVersion = process.env.ENCRYPTION_ACTIVE_KEY_VERSION;
  if (!activeVersion) {
    throw new CryptoConfigError('ENCRYPTION_ACTIVE_KEY_VERSION is not set but DATA_ENCRYPTION_ENABLED=true');
  }
  const activeKey = keks[activeVersion];
  if (!activeKey) {
    throw new CryptoConfigError(
      `ENCRYPTION_ACTIVE_KEY_VERSION="${activeVersion}" has no matching entry in ENCRYPTION_KEKS`
    );
  }

  return {
    getActiveKey(): VersionedKey {
      return { version: activeVersion, key: activeKey };
    },
    getKey(version: string): VersionedKey | null {
      const key = keks[version];
      return key ? { version, key } : null;
    }
  };
}
