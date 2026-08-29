/**
 * Тонкая обёртка над `crypto.randomBytes` (Node built-in CSPRNG,
 * OpenSSL `RAND_bytes`) — §0 запрещает писать генератор случайности
 * самостоятельно; этот файл существует не как «свой RNG», а как один
 * именованный источник для мока в тестах (детерминированный DEK/nonce
 * в юнит-тестах envelope.ts) без подмены глобального `crypto` модуля.
 */
import { randomBytes as nodeRandomBytes } from 'crypto';

export function randomBytes(length: number): Buffer {
  return nodeRandomBytes(length);
}

/** DEK и wrap-nonce используют один и тот же примитив — константы здесь
 * задают длины один раз, а не магическими числами по всем вызовам. */
export const AES_256_KEY_LENGTH = 32; // 256 бит
export const GCM_NONCE_LENGTH = 12; // 96 бит — стандартный размер nonce AES-GCM
export const GCM_TAG_LENGTH = 16; // 128 бит

export function randomKey(): Buffer {
  return randomBytes(AES_256_KEY_LENGTH);
}

export function randomNonce(): Buffer {
  return randomBytes(GCM_NONCE_LENGTH);
}

/**
 * §10 (Auth Assurance Hardening, 20.52.1) — `Buffer.from(str, 'base64')`
 * is not a validity check: Node silently skips characters outside the
 * base64 alphabet and does not enforce canonical padding, so malformed
 * or non-canonical input can still decode to a same-length buffer that
 * differs from what the sender intended. Used everywhere a base64 string
 * comes from outside this process (env vars, stored envelope fields)
 * before it is trusted as key/nonce/tag/ciphertext material.
 */
const STRICT_BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Empty string is valid canonical base64 for a zero-length buffer (e.g.
 * AES-GCM ciphertext of an empty plaintext) — rejected only when
 * non-empty AND malformed/non-canonical. */
export function strictBase64Decode(value: string): Buffer {
  if (typeof value !== 'string' || !STRICT_BASE64_RE.test(value)) {
    throw new Error('Malformed base64');
  }
  return Buffer.from(value, 'base64');
}
