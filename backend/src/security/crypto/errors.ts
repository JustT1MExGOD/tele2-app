/**
 * §29 — сообщения этих ошибок обязаны оставаться безопасными для логов и
 * для ответа клиенту как есть (алгоритм/версия/причина класса — не секрет);
 * ни один конструктор здесь не принимает и не хранит plaintext/ключ/DEK/
 * nonce-значение. Если когда-нибудь понадобится приложить сырые байты для
 * отладки — это отдельное поле, которое explicit НЕ уходит в `.message`.
 */

export class CryptoConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoConfigError';
  }
}

export class UnknownKeyVersionError extends Error {
  constructor(public readonly keyVersion: string) {
    super(`Unknown key version: ${keyVersion}`);
    this.name = 'UnknownKeyVersionError';
  }
}

/** AEAD tag не сошёлся — испорченный ciphertext/nonce/wrappedKey ИЛИ AAD не
 * совпадает с контекстом (§6 — ciphertext перенесён в другую запись). Оба
 * случая неотличимы намеренно: GCM не говорит, что именно не сошлось. */
export class DecryptionError extends Error {
  constructor(message = 'Decryption failed: authentication tag mismatch') {
    super(message);
    this.name = 'DecryptionError';
  }
}

/** Конверт не проходит структурную проверку до попытки расшифровать —
 * неизвестная версия/алгоритм, некорректный base64, неверная длина. */
export class InvalidEnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidEnvelopeError';
  }
}

/** §38 — feature flag выключен, а код попытался зашифровать/расшифровать. */
export class EncryptionDisabledError extends Error {
  constructor() {
    super('Application-level encryption is disabled (DATA_ENCRYPTION_ENABLED is not true)');
    this.name = 'EncryptionDisabledError';
  }
}
