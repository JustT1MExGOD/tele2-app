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
