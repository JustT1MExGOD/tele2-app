/**
 * 20.51.0 (Application-Level Envelope Encryption, Phase B) — crypto test
 * suite для backend/src/security/crypto/**. Использует in-memory
 * KeyProvider'ы построенные вручную (не EnvKeyProvider) — тесты AEAD/
 * envelope-логики не должны зависеть от process.env; env-парсинг
 * покрыт отдельным describe-блоком ниже.
 */
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'crypto';
import { aeadDecrypt, aeadEncrypt, constantTimeEqual } from '../../src/security/crypto/aead.js';
import { hkdfDerive } from '../../src/security/crypto/kdf.js';
import { canonicalAad, decryptField, encryptField, isEncryptedEnvelope, assertEnvelopeShape } from '../../src/security/crypto/envelope.js';
import { wrapDek, unwrapDek } from '../../src/security/crypto/keyring.js';
import { DecryptionError, InvalidEnvelopeError, UnknownKeyVersionError } from '../../src/security/crypto/errors.js';
import {
  assertEncryptionConfigValid,
  assertProductionEncryptionRequired,
  createEnvKeyProvider,
  isEncryptionEnabled
} from '../../src/security/crypto/key-provider.js';
import { strictBase64Decode } from '../../src/security/crypto/random.js';
import type { EncryptedEnvelope, KeyProvider } from '../../src/security/crypto/types.js';

function testKeyProvider(versions: Record<string, string>, activeVersion: string): KeyProvider {
  const keys: Record<string, Buffer> = {};
  for (const [v, seed] of Object.entries(versions)) keys[v] = Buffer.alloc(32, seed);
  return {
    getActiveKey: () => ({ version: activeVersion, key: keys[activeVersion] }),
    getKey: (v: string) => (keys[v] ? { version: v, key: keys[v] } : null)
  };
}

describe('security/crypto/aead — AES-256-GCM', () => {
  it('encrypt → decrypt round-trip', () => {
    const key = randomBytes(32);
    const aad = Buffer.from('ctx');
    const box = aeadEncrypt(key, Buffer.from('hello world'), aad);
    expect(aeadDecrypt(key, box, aad).toString('utf8')).toBe('hello world');
  });

  it('wrong key — decryption fails', () => {
    const key = randomBytes(32);
    const wrongKey = randomBytes(32);
    const box = aeadEncrypt(key, Buffer.from('secret'), Buffer.from('ctx'));
    expect(() => aeadDecrypt(wrongKey, box, Buffer.from('ctx'))).toThrow(DecryptionError);
  });

  it('wrong AAD — decryption fails (context binding)', () => {
    const key = randomBytes(32);
    const box = aeadEncrypt(key, Buffer.from('secret'), Buffer.from('ctx-a'));
    expect(() => aeadDecrypt(key, box, Buffer.from('ctx-b'))).toThrow(DecryptionError);
  });

  it('modified ciphertext — decryption fails', () => {
    const key = randomBytes(32);
    const box = aeadEncrypt(key, Buffer.from('secret'), Buffer.from('ctx'));
    const tampered = { ...box, ciphertext: Buffer.from(box.ciphertext, 'base64').map((b, i) => (i === 0 ? b ^ 0xff : b)).toString('base64') };
    expect(() => aeadDecrypt(key, tampered, Buffer.from('ctx'))).toThrow(DecryptionError);
  });

  it('modified nonce — decryption fails', () => {
    const key = randomBytes(32);
    const box = aeadEncrypt(key, Buffer.from('secret'), Buffer.from('ctx'));
    const tampered = { ...box, nonce: Buffer.from(box.nonce, 'base64').map((b, i) => (i === 0 ? b ^ 0xff : b)).toString('base64') };
    expect(() => aeadDecrypt(key, tampered, Buffer.from('ctx'))).toThrow(DecryptionError);
  });

  it('modified tag — decryption fails', () => {
    const key = randomBytes(32);
    const box = aeadEncrypt(key, Buffer.from('secret'), Buffer.from('ctx'));
    const tampered = { ...box, tag: Buffer.from(box.tag, 'base64').map((b, i) => (i === 0 ? b ^ 0xff : b)).toString('base64') };
    expect(() => aeadDecrypt(key, tampered, Buffer.from('ctx'))).toThrow(DecryptionError);
  });

  it('nonce is unique per call (same key, same plaintext)', () => {
    const key = randomBytes(32);
    const a = aeadEncrypt(key, Buffer.from('same'), Buffer.from('ctx'));
    const b = aeadEncrypt(key, Buffer.from('same'), Buffer.from('ctx'));
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ciphertext).not.toBe(b.ciphertext); // GCM — разный nonce даёт разный ciphertext даже на тот же plaintext
  });

  it('rejects a non-32-byte key', () => {
    const shortKey = randomBytes(16);
    expect(() => aeadEncrypt(shortKey, Buffer.from('x'), Buffer.from('ctx'))).toThrow(InvalidEnvelopeError);
  });

  it('constantTimeEqual — equal/unequal buffers, mismatched length', () => {
    expect(constantTimeEqual(Buffer.from('abc'), Buffer.from('abc'))).toBe(true);
    expect(constantTimeEqual(Buffer.from('abc'), Buffer.from('abd'))).toBe(false);
    expect(constantTimeEqual(Buffer.from('abc'), Buffer.from('ab'))).toBe(false);
  });
});

describe('security/crypto/kdf — HKDF domain separation', () => {
  it('same IKM, different info labels → different output', () => {
    const ikm = randomBytes(32);
    const a = hkdfDerive(ikm, Buffer.alloc(0), 't2/envelope/wrap-key/v1');
    const b = hkdfDerive(ikm, Buffer.alloc(0), 't2/other-purpose/v1');
    expect(a.equals(b)).toBe(false);
  });

  it('same IKM, same info → deterministic output', () => {
    const ikm = randomBytes(32);
    const a = hkdfDerive(ikm, Buffer.alloc(0), 't2/envelope/wrap-key/v1');
    const b = hkdfDerive(ikm, Buffer.alloc(0), 't2/envelope/wrap-key/v1');
    expect(a.equals(b)).toBe(true);
  });

  it('rejects an empty domain label', () => {
    expect(() => hkdfDerive(randomBytes(32), Buffer.alloc(0), '')).toThrow();
  });
});

describe('security/crypto/keyring — DEK wrap/unwrap', () => {
  it('wrap → unwrap round-trip with the same AAD', () => {
    const kp = testKeyProvider({ v1: 0x11 }, 'v1');
    const dek = randomBytes(32);
    const aad = Buffer.from('type=x&id=1');
    const { kid, box } = wrapDek(kp, dek, aad);
    expect(kid).toBe('v1');
    expect(unwrapDek(kp, kid, box, aad).equals(dek)).toBe(true);
  });

  it('unwrap with an unknown key version throws UnknownKeyVersionError', () => {
    const kp = testKeyProvider({ v1: 0x11 }, 'v1');
    const dek = randomBytes(32);
    const aad = Buffer.from('ctx');
    const { box } = wrapDek(kp, dek, aad);
    expect(() => unwrapDek(kp, 'v999', box, aad)).toThrow(UnknownKeyVersionError);
  });

  it('unwrap with a different AAD than was used to wrap fails', () => {
    const kp = testKeyProvider({ v1: 0x11 }, 'v1');
    const { kid, box } = wrapDek(kp, randomBytes(32), Buffer.from('ctx-a'));
    expect(() => unwrapDek(kp, kid, box, Buffer.from('ctx-b'))).toThrow(DecryptionError);
  });
});

describe('security/crypto/envelope — encryptField/decryptField', () => {
  const ctx = { type: 'support_ticket.message', id: 42, schema_v: 1 };

  it('encrypt → decrypt round-trip', () => {
    const kp = testKeyProvider({ v1: 0x22 }, 'v1');
    const envelope = encryptField('Здравствуйте, у меня проблема с кассой', ctx, kp);
    expect(envelope.v).toBe(1);
    expect(envelope.alg).toBe('aes-256-gcm');
    expect(envelope.kid).toBe('v1');
    expect(decryptField(envelope, ctx, kp)).toBe('Здравствуйте, у меня проблема с кассой');
  });

  it('wrong KEK (different provider entirely) — decryption fails', () => {
    const kpA = testKeyProvider({ v1: 0x33 }, 'v1');
    const kpB = testKeyProvider({ v1: 0x44 }, 'v1'); // same version name, different key material
    const envelope = encryptField('secret', ctx, kpA);
    expect(() => decryptField(envelope, ctx, kpB)).toThrow(DecryptionError);
  });

  it('wrong AAD — ciphertext transplanted from object A to object B fails (§6)', () => {
    const kp = testKeyProvider({ v1: 0x55 }, 'v1');
    const envelopeForTicket42 = encryptField('приватный текст', { type: 'support_ticket.message', id: 42, schema_v: 1 }, kp);
    const wrongContext = { type: 'support_ticket.message', id: 43, schema_v: 1 }; // другой id
    expect(() => decryptField(envelopeForTicket42, wrongContext, kp)).toThrow(DecryptionError);
  });

  it('modified ciphertext.data.ciphertext — decryption fails', () => {
    const kp = testKeyProvider({ v1: 0x66 }, 'v1');
    const envelope = encryptField('secret', ctx, kp);
    const tampered: EncryptedEnvelope = {
      ...envelope,
      data: { ...envelope.data, ciphertext: Buffer.from(envelope.data.ciphertext, 'base64').map((b, i) => (i === 0 ? b ^ 0xff : b)).toString('base64') }
    };
    expect(() => decryptField(tampered, ctx, kp)).toThrow(DecryptionError);
  });

  it('modified wrappedKey (dek box) — decryption fails', () => {
    const kp = testKeyProvider({ v1: 0x77 }, 'v1');
    const envelope = encryptField('secret', ctx, kp);
    const tampered: EncryptedEnvelope = {
      ...envelope,
      dek: { ...envelope.dek, ciphertext: Buffer.from(envelope.dek.ciphertext, 'base64').map((b, i) => (i === 0 ? b ^ 0xff : b)).toString('base64') }
    };
    expect(() => decryptField(tampered, ctx, kp)).toThrow(DecryptionError);
  });

  it('key rotation: old envelope (kid=v1) still decrypts after active version moves to v2', () => {
    const kpV1Active = testKeyProvider({ v1: 0x88 }, 'v1');
    const envelope = encryptField('rotate me', ctx, kpV1Active);
    expect(envelope.kid).toBe('v1');

    // Тот же provider знает про обе версии, но активная теперь v2 — новые
    // объекты шифровались бы v2, но старый конверт (kid=v1) остаётся
    // читаемым без re-encryption всего хранилища (§8).
    const kpRotated: KeyProvider = {
      getActiveKey: () => ({ version: 'v2', key: Buffer.alloc(32, 0x99) }),
      getKey: (v: string) => (v === 'v1' ? { version: 'v1', key: Buffer.alloc(32, 0x88) } : v === 'v2' ? { version: 'v2', key: Buffer.alloc(32, 0x99) } : null)
    };
    expect(decryptField(envelope, ctx, kpRotated)).toBe('rotate me');

    const newEnvelope = encryptField('new data', ctx, kpRotated);
    expect(newEnvelope.kid).toBe('v2');
    expect(decryptField(newEnvelope, ctx, kpRotated)).toBe('new data');
  });

  it('DEK/nonce uniqueness — same plaintext encrypted twice yields different envelopes', () => {
    const kp = testKeyProvider({ v1: 0xaa }, 'v1');
    const e1 = encryptField('same text', ctx, kp);
    const e2 = encryptField('same text', ctx, kp);
    expect(e1.data.ciphertext).not.toBe(e2.data.ciphertext);
    expect(e1.dek.ciphertext).not.toBe(e2.dek.ciphertext);
  });
});

describe('security/crypto/envelope — parser fail-closed (§36 fuzz/adversarial)', () => {
  const kp = testKeyProvider({ v1: 0xbb }, 'v1');
  const valid = encryptField('x', { type: 't', id: 1 }, kp);

  it('accepts a well-formed envelope', () => {
    expect(isEncryptedEnvelope(valid)).toBe(true);
  });

  it.each([
    ['null', null],
    ['not an object', 'a string'],
    ['array', []],
    ['unknown version', { ...valid, v: 2 }],
    ['unsupported algorithm', { ...valid, alg: 'chacha20-poly1305' }],
    ['missing kid', { ...valid, kid: undefined }],
    ['empty kid', { ...valid, kid: '' }],
    ['missing data box', { ...valid, data: undefined }],
    ['malformed data box (missing ciphertext)', { ...valid, data: { nonce: valid.data.nonce, tag: valid.data.tag } }],
    ['malformed dek box (missing nonce)', { ...valid, dek: { tag: valid.dek.tag, ciphertext: valid.dek.ciphertext } }]
  ])('rejects: %s', (_label, malformed) => {
    expect(isEncryptedEnvelope(malformed)).toBe(false);
    expect(() => assertEnvelopeShape(malformed)).toThrow(InvalidEnvelopeError);
  });

  it('rejects garbage ciphertext bytes at decrypt time (not at shape-check time) — fails closed either way', () => {
    // Node's base64 decoder is lenient (silently drops non-alphabet chars)
    // rather than throwing on malformed input — the invariant that matters
    // (§36) is that this NEVER decrypts successfully, not which exact
    // error class it throws (InvalidEnvelopeError vs DecryptionError,
    // depending on whether the garbage happens to decode to the right
    // byte length).
    const malformed: EncryptedEnvelope = { ...valid, data: { ...valid.data, ciphertext: '###not-base64###' } };
    let threw = false;
    try {
      decryptField(malformed, { type: 't', id: 1 }, kp);
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(Error);
      expect(['InvalidEnvelopeError', 'DecryptionError']).toContain((e as Error).name);
    }
    expect(threw).toBe(true);
  });

  it('rejects a truncated/short nonce', () => {
    const malformed: EncryptedEnvelope = { ...valid, data: { ...valid.data, nonce: Buffer.alloc(4).toString('base64') } };
    expect(() => decryptField(malformed, { type: 't', id: 1 }, kp)).toThrow(InvalidEnvelopeError);
  });
});

describe('security/crypto/envelope — canonicalAad determinism', () => {
  it('key order in the input object does not change the serialized AAD', () => {
    const a = canonicalAad({ type: 'x', id: 1, schema_v: 1 });
    const b = canonicalAad({ schema_v: 1, id: 1, type: 'x' });
    expect(a.equals(b)).toBe(true);
  });

  it('different values produce different AAD bytes', () => {
    const a = canonicalAad({ type: 'x', id: 1 });
    const b = canonicalAad({ type: 'x', id: 2 });
    expect(a.equals(b)).toBe(false);
  });
});

describe('security/crypto/key-provider — env parsing (§4/§8/§38)', () => {
  const ORIGINAL = { ...process.env };
  function restoreEnv() {
    for (const k of Object.keys(process.env)) {
      if (!(k in ORIGINAL)) delete process.env[k];
    }
    Object.assign(process.env, ORIGINAL);
  }

  it('isEncryptionEnabled() is false by default', () => {
    restoreEnv();
    delete process.env.DATA_ENCRYPTION_ENABLED;
    expect(isEncryptionEnabled()).toBe(false);
  });

  it('assertEncryptionConfigValid() no-ops when the flag is off, even with no keys configured', () => {
    restoreEnv();
    delete process.env.DATA_ENCRYPTION_ENABLED;
    delete process.env.ENCRYPTION_KEKS;
    expect(() => assertEncryptionConfigValid()).not.toThrow();
    restoreEnv();
  });

  it('createEnvKeyProvider() resolves the active key and older versions from ENCRYPTION_KEKS', () => {
    restoreEnv();
    const v1 = Buffer.alloc(32, 1).toString('base64');
    const v2 = Buffer.alloc(32, 2).toString('base64');
    process.env.DATA_ENCRYPTION_ENABLED = 'true';
    process.env.ENCRYPTION_KEKS = JSON.stringify({ '2026-01': v1, '2026-02': v2 });
    process.env.ENCRYPTION_ACTIVE_KEY_VERSION = '2026-02';
    expect(() => assertEncryptionConfigValid()).not.toThrow();
    const kp = createEnvKeyProvider();
    expect(kp.getActiveKey().version).toBe('2026-02');
    expect(kp.getKey('2026-01')?.version).toBe('2026-01');
    expect(kp.getKey('does-not-exist')).toBeNull();
    restoreEnv();
  });

  it('rejects when ENCRYPTION_KEKS is missing while flag is on', () => {
    restoreEnv();
    process.env.DATA_ENCRYPTION_ENABLED = 'true';
    delete process.env.ENCRYPTION_KEKS;
    expect(() => assertEncryptionConfigValid()).toThrow();
    restoreEnv();
  });

  it('rejects when ENCRYPTION_ACTIVE_KEY_VERSION points to a version absent from ENCRYPTION_KEKS', () => {
    restoreEnv();
    process.env.DATA_ENCRYPTION_ENABLED = 'true';
    process.env.ENCRYPTION_KEKS = JSON.stringify({ v1: Buffer.alloc(32, 1).toString('base64') });
    process.env.ENCRYPTION_ACTIVE_KEY_VERSION = 'v2';
    expect(() => assertEncryptionConfigValid()).toThrow();
    restoreEnv();
  });

  it('rejects a key that does not decode to 32 bytes', () => {
    restoreEnv();
    process.env.DATA_ENCRYPTION_ENABLED = 'true';
    process.env.ENCRYPTION_KEKS = JSON.stringify({ v1: Buffer.alloc(16, 1).toString('base64') });
    process.env.ENCRYPTION_ACTIVE_KEY_VERSION = 'v1';
    expect(() => assertEncryptionConfigValid()).toThrow();
    restoreEnv();
  });

  it('rejects malformed JSON in ENCRYPTION_KEKS', () => {
    restoreEnv();
    process.env.DATA_ENCRYPTION_ENABLED = 'true';
    process.env.ENCRYPTION_KEKS = '{not json';
    process.env.ENCRYPTION_ACTIVE_KEY_VERSION = 'v1';
    expect(() => assertEncryptionConfigValid()).toThrow();
    restoreEnv();
  });

  // §9/CRYPTO-1 (Auth Assurance Hardening, 20.52.1)
  it('assertProductionEncryptionRequired() throws when the flag is off', () => {
    restoreEnv();
    delete process.env.DATA_ENCRYPTION_ENABLED;
    expect(() => assertProductionEncryptionRequired()).toThrow(/DATA_ENCRYPTION_ENABLED must be true/);
    restoreEnv();
  });

  it('assertProductionEncryptionRequired() throws when the flag is on but misconfigured (delegates to assertEncryptionConfigValid)', () => {
    restoreEnv();
    process.env.DATA_ENCRYPTION_ENABLED = 'true';
    delete process.env.ENCRYPTION_KEKS;
    expect(() => assertProductionEncryptionRequired()).toThrow();
    restoreEnv();
  });

  it('assertProductionEncryptionRequired() passes when the flag is on and correctly configured', () => {
    restoreEnv();
    process.env.DATA_ENCRYPTION_ENABLED = 'true';
    process.env.ENCRYPTION_KEKS = JSON.stringify({ v1: Buffer.alloc(32, 1).toString('base64') });
    process.env.ENCRYPTION_ACTIVE_KEY_VERSION = 'v1';
    expect(() => assertProductionEncryptionRequired()).not.toThrow();
    restoreEnv();
  });
});

// §10/CRYPTO-1 (Auth Assurance Hardening, 20.52.1) — Buffer.from(str,'base64')
// is not a validity check (silently drops invalid characters instead of
// throwing); strictBase64Decode() is the shared helper used everywhere a
// base64 string is trusted as key/nonce/tag/ciphertext material.
describe('security/crypto/random — strictBase64Decode (§10)', () => {
  it('accepts canonical base64, including the empty string (zero-length buffer)', () => {
    expect(strictBase64Decode('').length).toBe(0);
    const key = Buffer.alloc(32, 9);
    expect(strictBase64Decode(key.toString('base64')).equals(key)).toBe(true);
  });

  it('rejects characters outside the base64 alphabet', () => {
    expect(() => strictBase64Decode('###not-base64###')).toThrow();
    expect(() => strictBase64Decode('abc def')).toThrow(); // space
    expect(() => strictBase64Decode('abc_def')).toThrow(); // base64url, not base64
  });

  it('rejects incorrect padding/length', () => {
    expect(() => strictBase64Decode('QQ')).toThrow(); // 2 chars, no padding — not a valid block
    expect(() => strictBase64Decode('QQ===')).toThrow(); // too much padding
  });

  it('a malformed KEK that Buffer.from() would silently accept is rejected in ENCRYPTION_KEKS parsing', () => {
    const ORIGINAL = { ...process.env };
    process.env.DATA_ENCRYPTION_ENABLED = 'true';
    // 32 valid base64 chars decode to 24 bytes normally, but appending a
    // stray non-alphabet character is exactly the kind of input
    // Buffer.from(str,'base64') decodes anyway (silently dropping it) —
    // this must now be rejected before it ever reaches key-length checks.
    process.env.ENCRYPTION_KEKS = JSON.stringify({ v1: Buffer.alloc(32, 1).toString('base64') + '!' });
    process.env.ENCRYPTION_ACTIVE_KEY_VERSION = 'v1';
    expect(() => assertEncryptionConfigValid()).toThrow(/base64/i);
    for (const k of Object.keys(process.env)) if (!(k in ORIGINAL)) delete process.env[k];
    Object.assign(process.env, ORIGINAL);
  });
});
