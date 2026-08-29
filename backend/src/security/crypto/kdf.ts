/**
 * §0/§15 — HKDF через `node:crypto.hkdfSync` (built-in, RFC 5869, доступен
 * с Node 15) — не самописный. Единственная сегодняшняя роль в этом слое:
 * развести derived wrap-key от сырого KEK по domain-label'у, чтобы один и
 * тот же env-секрет, если он когда-нибудь понадобится ещё для одной цели
 * (не только оборачивания DEK), не превращался в тот же самый ключ по
 * недосмотру. Domain-разделение как в §15 — отдельная `info`-строка на
 * каждое назначение, `t2/envelope/*`, не `t2/e2ee/*` (E2EE не реализован,
 * см. docs/ADR/00X-e2ee.md).
 */
import { hkdfSync } from 'crypto';
import { AES_256_KEY_LENGTH } from './random.js';

/** `info` обязан быть непустой доменной меткой — иначе легко случайно
 * вызвать hkdf с одинаковым info из двух разных мест и свести на нет весь
 * смысл derive-по-назначению. */
export function hkdfDerive(ikm: Buffer, salt: Buffer, info: string, length: number = AES_256_KEY_LENGTH): Buffer {
  if (!info) throw new Error('hkdfDerive: info (domain label) must not be empty');
  const out = hkdfSync('sha256', ikm, salt, Buffer.from(info, 'utf8'), length);
  return Buffer.from(out);
}
