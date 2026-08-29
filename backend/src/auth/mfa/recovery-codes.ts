/**
 * Recovery codes — CSPRNG, shown once in plaintext at generation, only
 * a SHA-256 hash stored (§6: "store only secure hashes"; these are
 * opaque bearer secrets like a session token, not recoverable material
 * like a TOTP seed, so a one-way hash is correct here — see §44).
 */
import { randomBytes, createHash } from 'crypto';
import * as mfaRepo from '../../data/repositories/mfa.js';

const CODE_COUNT = 10;
/** 10 bytes → 16 base32-ish chars formatted "xxxx-xxxx-xxxx-xxxx" — same
 * order of magnitude entropy as the session/reset tokens elsewhere in
 * this codebase (32 raw bytes), scaled down only because a human must be
 * able to type this one manually if the primary device is unavailable. */
function generateOneCode(): string {
  const raw = randomBytes(10).toString('hex'); // 20 hex chars
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}`;
}

function hashCode(code: string): string {
  return createHash('sha256').update(code.trim().toLowerCase()).digest('hex');
}

/** Regeneration invalidates the previous batch entirely (replaceRecoveryCodes
 * DELETEs all prior rows before inserting the new batch) — §6. */
export async function generateRecoveryCodes(employeeId: number): Promise<string[]> {
  const codes = Array.from({ length: CODE_COUNT }, generateOneCode);
  await mfaRepo.replaceRecoveryCodes(employeeId, codes.map(hashCode));
  return codes;
}

export async function countRemainingRecoveryCodes(employeeId: number): Promise<number> {
  return mfaRepo.countActiveRecoveryCodes(employeeId);
}

/** Atomically single-use (mfaRepo.consumeRecoveryCode is an UPDATE...
 * WHERE used_at IS NULL...RETURNING, race-safe against concurrent replay
 * of the same code from two requests). */
export async function consumeRecoveryCode(employeeId: number, code: string): Promise<boolean> {
  const normalized = String(code || '').trim();
  if (!normalized) return false;
  return mfaRepo.consumeRecoveryCode(employeeId, hashCode(normalized));
}

export async function deleteAllRecoveryCodes(employeeId: number): Promise<void> {
  await mfaRepo.deleteAllRecoveryCodes(employeeId);
}
