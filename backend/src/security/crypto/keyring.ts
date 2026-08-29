/**
 * §4/§8/§15 — оборачивает/разворачивает DEK активным (или конкретной
 * версии, для чтения старых записей) KEK. Сам KEK никогда не используется
 * для AEAD напрямую — сначала HKDF с фиксированной domain-меткой
 * `t2/envelope/wrap-key/v1` (не завязана на key_version ротации: KEK уже
 * даёт версионную развязку сам по себе, метка здесь — про НАЗНАЧЕНИЕ
 * ключа, «оборачивание DEK», не про то, какая по счёту версия KEK).
 *
 * Wrap-слой связан тем же AAD, что и data-слой (envelope.ts передаёт
 * один и тот же context в оба места) — перенос `dek`-блока из одной
 * записи в другую ломает unwrap так же надёжно, как перенос `data`-блока.
 */
import { aeadDecrypt, aeadEncrypt } from './aead.js';
import { hkdfDerive } from './kdf.js';
import { UnknownKeyVersionError } from './errors.js';
import type { AeadBox, KeyProvider } from './types.js';

const WRAP_KEY_INFO = 't2/envelope/wrap-key/v1';

function deriveWrapKey(kek: Buffer): Buffer {
  return hkdfDerive(kek, Buffer.alloc(0), WRAP_KEY_INFO);
}

export function wrapDek(keyProvider: KeyProvider, dek: Buffer, aad: Buffer): { kid: string; box: AeadBox } {
  const { version, key: kek } = keyProvider.getActiveKey();
  const wrapKey = deriveWrapKey(kek);
  const box = aeadEncrypt(wrapKey, dek, aad);
  return { kid: version, box };
}

export function unwrapDek(keyProvider: KeyProvider, kid: string, box: AeadBox, aad: Buffer): Buffer {
  const versioned = keyProvider.getKey(kid);
  if (!versioned) throw new UnknownKeyVersionError(kid);
  const wrapKey = deriveWrapKey(versioned.key);
  return aeadDecrypt(wrapKey, box, aad);
}
