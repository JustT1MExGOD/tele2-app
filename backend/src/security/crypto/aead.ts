/**
 * §0/§5 — AEAD через `node:crypto`'s AES-256-GCM (OpenSSL, built into
 * Node/Railway's runtime — никакой новой зависимости, никакого native
 * addon, который мог бы не собраться на Nixpacks). Осознанно НЕ
 * XChaCha20-Poly1305: зрелая реализация для нашего стека потребовала бы
 * стороннюю библиотеку (Node не даёт XChaCha20 из коробки — только
 * 12-байтный ChaCha20-Poly1305, без extended nonce), а проект уже
 * последовательно предпочитает built-in примитивы там, где они реально
 * покрывают задачу (`auth/password.ts` — `crypto.scrypt`, не bcrypt/argon2).
 * AES-256-GCM с 12-байтным случайным nonce на ключ — тот же выбор, что
 * AWS/GCP KMS делают для envelope encryption; при уникальном DEK на
 * объект и derived wrap-key на версию KEK риск коллизии nonce
 * пренебрежимо мал (NIST SP 800-38D — до 2^32 вызовов на ключ).
 *
 * Этот модуль не знает про DEK/KEK/конверты — только «шифруй байты этим
 * 32-байтным ключом с этим AAD», выше уровня абстракции нет.
 */
import { createCipheriv, createDecipheriv, timingSafeEqual } from 'crypto';
import type { AeadBox } from './types.js';
import { DecryptionError, InvalidEnvelopeError } from './errors.js';
import { AES_256_KEY_LENGTH, GCM_NONCE_LENGTH, GCM_TAG_LENGTH, randomNonce, strictBase64Decode } from './random.js';

function assertKeyLength(key: Buffer): void {
  if (key.length !== AES_256_KEY_LENGTH) {
    throw new InvalidEnvelopeError(`AES-256-GCM key must be ${AES_256_KEY_LENGTH} bytes, got ${key.length}`);
  }
}

export function aeadEncrypt(key: Buffer, plaintext: Buffer, aad: Buffer): AeadBox {
  assertKeyLength(key);
  const nonce = randomNonce();
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    nonce: nonce.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64')
  };
}

/**
 * Единственный throw здесь — `DecryptionError`, независимо от ТОГО, что
 * именно не сошлось (испорченный ciphertext, чужой AAD, неверный ключ) —
 * GCM намеренно не различает эти случаи наружу (timing/oracle-safety),
 * поэтому и наш API не должен утекать больше информации, чем сам AEAD.
 */
export function aeadDecrypt(key: Buffer, box: AeadBox, aad: Buffer): Buffer {
  assertKeyLength(key);
  let nonce: Buffer, tag: Buffer, ciphertext: Buffer;
  try {
    nonce = strictBase64Decode(box.nonce);
    tag = strictBase64Decode(box.tag);
    // Ciphertext length varies with payload size — no canonical-length
    // check beyond "valid base64" makes sense here (unlike nonce/tag).
    ciphertext = strictBase64Decode(box.ciphertext);
  } catch {
    throw new InvalidEnvelopeError('Malformed base64 in AEAD box');
  }
  if (nonce.length !== GCM_NONCE_LENGTH || tag.length !== GCM_TAG_LENGTH) {
    throw new InvalidEnvelopeError('Invalid nonce/tag length in AEAD box');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // node:crypto бросает "Unsupported state or unable to authenticate
    // data" с деталями реализации в сообщении — не пробрасываем как есть.
    throw new DecryptionError();
  }
}

/** Используется только тестами/будущими адаптерами, которым нужно сравнить
 * два байтовых буфера constant-time (не через AEAD) — обёртка вместо
 * прямого импорта `crypto` в местах, куда not-crypto код не должен лезть. */
export function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
