/**
 * §3/§6/§7 — публичная точка входа этого слоя. `encryptField`/`decryptField`
 * — то, что реально вызывают репозитории (data/repositories/support.ts и
 * будущие потребители): генерируют/используют одноразовый DEK, шифруют
 * им payload, оборачивают DEK активным KEK, отдают версионированный
 * `EncryptedEnvelope`, готовый лечь в jsonb-колонку как есть.
 *
 * AAD криптографически связывает ciphertext с контекстом объекта (§6) —
 * `canonicalAad()` сериализует его детерминированно (отсортированные
 * ключи, без пробелов), чтобы шифрование и расшифровка одного и того же
 * контекста всегда давали одинаковые байты AAD независимо от порядка
 * полей в вызывающем коде.
 */
import { aeadDecrypt, aeadEncrypt } from './aead.js';
import { unwrapDek, wrapDek } from './keyring.js';
import { randomKey } from './random.js';
import { InvalidEnvelopeError } from './errors.js';
import type { AadContext, EncryptedEnvelope, KeyProvider } from './types.js';

const SUPPORTED_ALG = 'aes-256-gcm' as const;
const SUPPORTED_V = 1 as const;

export function canonicalAad(context: AadContext): Buffer {
  const sortedKeys = Object.keys(context).sort();
  const canonical = sortedKeys.map((k) => `${k}=${String(context[k])}`).join('');
  return Buffer.from(canonical, 'utf8');
}

export function encryptField(plaintext: string, context: AadContext, keyProvider: KeyProvider): EncryptedEnvelope {
  const aad = canonicalAad(context);
  const dek = randomKey();
  const data = aeadEncrypt(dek, Buffer.from(plaintext, 'utf8'), aad);
  const { kid, box: dekBox } = wrapDek(keyProvider, dek, aad);
  dek.fill(0); // §30 — лучшее, что доступно в JS: обнулить буфер сразу после использования, не гарантия GC-стирания
  return { v: SUPPORTED_V, alg: SUPPORTED_ALG, kid, dek: dekBox, data };
}

export function decryptField(envelope: EncryptedEnvelope, context: AadContext, keyProvider: KeyProvider): string {
  assertEnvelopeShape(envelope);
  const aad = canonicalAad(context);
  const dek = unwrapDek(keyProvider, envelope.kid, envelope.dek, aad);
  try {
    const plaintext = aeadDecrypt(dek, envelope.data, aad);
    return plaintext.toString('utf8');
  } finally {
    dek.fill(0);
  }
}

/** Структурная проверка ДО передачи в AEAD — malformed/будущая неизвестная
 * версия должна упасть здесь с понятной ошибкой, не глубоко внутри
 * `createDecipheriv` с невнятным сообщением (§36 — parser fail closed). */
export function assertEnvelopeShape(value: unknown): asserts value is EncryptedEnvelope {
  if (typeof value !== 'object' || value === null) {
    throw new InvalidEnvelopeError('Envelope must be an object');
  }
  const v = value as Record<string, unknown>;
  if (v.v !== SUPPORTED_V) {
    throw new InvalidEnvelopeError(`Unsupported envelope version: ${String(v.v)}`);
  }
  if (v.alg !== SUPPORTED_ALG) {
    throw new InvalidEnvelopeError(`Unsupported algorithm: ${String(v.alg)}`);
  }
  if (typeof v.kid !== 'string' || !v.kid) {
    throw new InvalidEnvelopeError('Missing key id (kid)');
  }
  for (const boxField of ['dek', 'data'] as const) {
    const box = v[boxField] as Record<string, unknown> | undefined;
    if (
      typeof box !== 'object' ||
      box === null ||
      typeof box.nonce !== 'string' ||
      typeof box.tag !== 'string' ||
      typeof box.ciphertext !== 'string'
    ) {
      throw new InvalidEnvelopeError(`Malformed "${boxField}" box in envelope`);
    }
  }
}

/** Type guard для чтения из jsonb-колонки, которая может легитимно быть
 * NULL (объект создан до включения шифрования, см. §32 — это не «упавшее
 * шифрование», а честная историческая граница, задокументированная в
 * data/repositories/support.ts). */
export function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  try {
    assertEnvelopeShape(value);
    return true;
  } catch {
    return false;
  }
}
