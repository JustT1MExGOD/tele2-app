/**
 * Application-Level Envelope Encryption — публичный вход слоя. Потребители
 * вне этой директории (репозитории, будущие startup-гварды) импортируют
 * только отсюда, не из внутренних модулей напрямую — единая точка, откуда
 * видно весь API сразу.
 */
export type { AeadBox, EncryptedEnvelope, KeyProvider, VersionedKey, AadContext, KeyMaterial } from './types.js';
export {
  CryptoConfigError,
  UnknownKeyVersionError,
  DecryptionError,
  InvalidEnvelopeError,
  EncryptionDisabledError
} from './errors.js';
export { canonicalAad, encryptField, decryptField, isEncryptedEnvelope, assertEnvelopeShape } from './envelope.js';
export { isEncryptionEnabled, createEnvKeyProvider, assertEncryptionConfigValid, assertProductionEncryptionRequired } from './key-provider.js';
export { logDecryptFailure } from './log.js';
