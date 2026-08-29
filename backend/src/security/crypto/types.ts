/**
 * Application-Level Envelope Encryption (Web Security & Trust Layer,
 * Phase B) — типы. Ничего криптографического в этом файле, только формы
 * данных, которыми обмениваются aead.ts/kdf.ts/keyring.ts/envelope.ts.
 */

/** Один AEAD-результат — nonce/tag/ciphertext, каждый base64. Используется
 * и для самого payload, и для wrapped DEK — форма одна и та же, потому что
 * это один и тот же примитив (AES-256-GCM), применённый дважды. */
export interface AeadBox {
  nonce: string; // base64, 12 байт (96 бит) — стандартный nonce GCM
  tag: string; // base64, 16 байт — authentication tag
  ciphertext: string; // base64
}

/** Версионированный конверт — то, что реально хранится в БД. `v`/`alg`/`kid`
 * позволяют завтра сменить алгоритм или ротировать ключ, не теряя
 * способности прочитать уже сохранённые записи (docs/SECURITY.md —
 * Cryptographic Data Protection). */
export interface EncryptedEnvelope {
  v: 1;
  alg: 'aes-256-gcm';
  /** key_version активного KEK на момент шифрования — не текущего. */
  kid: string;
  /** DEK, обёрнутый (encrypted) активным KEK текущей версии `kid`. */
  dek: AeadBox;
  /** Сам payload, зашифрованный одноразовым DEK. */
  data: AeadBox;
}

/** Сырой ключевой материал — 32 байта (256 бит), для AES-256-GCM что для
 * KEK, что для DEK, что для производных ключей после HKDF. */
export type KeyMaterial = Buffer;

export interface VersionedKey {
  version: string;
  key: KeyMaterial;
}

/**
 * §4/§8 — Master/KEK приходит из окружения, версионирован, допускает
 * rotation: `getKey(oldVersion)` продолжает работать после того, как
 * `getActiveKey()` уже вернул новую версию — старые конверты остаются
 * читаемыми без немедленной re-encryption всего хранилища.
 */
export interface KeyProvider {
  getActiveKey(): VersionedKey;
  getKey(version: string): VersionedKey | null;
}

/** AAD — произвольный canonical-сериализуемый контекст объекта (тип,
 * id, владелец…), см. envelope.ts::canonicalAad(). Значения — только
 * string/number/boolean, без вложенных объектов: сериализация должна
 * быть однозначной без отдельной JSON-схемы. */
export type AadContext = Record<string, string | number | boolean>;
