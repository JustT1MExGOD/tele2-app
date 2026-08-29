/**
 * Data Access Layer — MFA (20.52.0): TOTP secrets (envelope-encrypted,
 * see security/crypto/**), WebAuthn credentials, recovery codes, and the
 * three short-lived opaque-token flows (pending login, WebAuthn
 * ceremony challenge, step-up ticket). Same discipline as
 * data/repositories/sessions.ts — only hashes of opaque tokens are
 * stored, raw values live only in the cookie/response the caller holds
 * momentarily.
 */
import { randomBytes, createHash } from 'crypto';
import { query } from '../db/index.js';
import { isEncryptionEnabled, createEnvKeyProvider, encryptField, decryptField, logDecryptFailure, type AadContext } from '../../security/crypto/index.js';
import { DecryptionError, InvalidEnvelopeError } from '../../security/crypto/errors.js';

function generateOpaqueToken(): string {
  return randomBytes(32).toString('hex');
}

function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ===== TOTP =====

const totpAad = (employeeId: number): AadContext => ({ type: 'employee_totp.secret', id: employeeId, schema_v: 1 });

/**
 * TOTP secrets are recoverable authentication material (verification
 * needs the original Base32 secret, not a one-way hash) — protected by
 * the same envelope-encryption layer as support-ticket text (ADR-007),
 * own AAD context so a TOTP envelope can never be swapped for another
 * object's ciphertext. If DATA_ENCRYPTION_ENABLED is false the secret is
 * stored as a plain string in the same jsonb column shape the decrypt
 * path already treats as "not encrypted" for support.ts — TOTP enrollment
 * itself should not be offered in that configuration (see mfa/totp.ts).
 */
export async function upsertPendingTotp(employeeId: number, secretBase32: string): Promise<void> {
  const stored = isEncryptionEnabled()
    ? JSON.stringify(encryptField(secretBase32, totpAad(employeeId), createEnvKeyProvider()))
    : JSON.stringify({ plain: secretBase32 });
  await query(
    `INSERT INTO employee_totp (employee_id, secret_encrypted, confirmed_at, last_time_step)
     VALUES ($1, $2::jsonb, NULL, NULL)
     ON CONFLICT (employee_id) DO UPDATE SET
       secret_encrypted = EXCLUDED.secret_encrypted,
       confirmed_at = NULL,
       last_time_step = NULL`,
    [employeeId, stored]
  );
}

export async function confirmTotp(employeeId: number): Promise<void> {
  await query(`UPDATE employee_totp SET confirmed_at = now() WHERE employee_id = $1`, [employeeId]);
}

interface TotpRow {
  employee_id: number;
  secret_encrypted: unknown;
  confirmed_at: string | null;
  last_time_step: number | null;
}

/** Returns null if no TOTP is enrolled OR the stored envelope fails to
 * decrypt (logged, never thrown to a caller trying a login/step-up —
 * treated the same as "not enrolled", not as a crash). */
export async function getTotpSecret(employeeId: number): Promise<{ secret: string; confirmed: boolean; lastTimeStep: number | null } | null> {
  const res = await query(`SELECT * FROM employee_totp WHERE employee_id = $1`, [employeeId]);
  const row = res.rows[0];
  if (!row) return null;
  const raw = row.secret_encrypted as any;
  try {
    const secret = raw?.plain ?? decryptField(raw, totpAad(employeeId), createEnvKeyProvider());
    return { secret, confirmed: !!row.confirmed_at, lastTimeStep: row.last_time_step === null ? null : Number(row.last_time_step) };
  } catch (e) {
    if (e instanceof DecryptionError || e instanceof InvalidEnvelopeError) {
      logDecryptFailure({ table: 'employee_totp.secret', id: employeeId }, e);
      return null;
    }
    throw e;
  }
}

export async function recordTotpUse(employeeId: number, timeStep: number): Promise<void> {
  await query(`UPDATE employee_totp SET last_time_step = $2, last_used_at = now() WHERE employee_id = $1`, [employeeId, timeStep]);
}

export async function deleteTotp(employeeId: number): Promise<void> {
  await query(`DELETE FROM employee_totp WHERE employee_id = $1`, [employeeId]);
}

// ===== WebAuthn credentials =====

export interface WebAuthnCredentialRow {
  id: number;
  employee_id: number;
  credential_id: string;
  public_key: string;
  counter: number;
  device_type: string | null;
  backed_up: boolean;
  device_name: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export async function createWebAuthnCredential(data: {
  employeeId: number;
  credentialId: string;
  publicKeyBase64: string;
  counter: number;
  deviceType: string;
  backedUp: boolean;
  deviceName: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO employee_webauthn_credentials
       (employee_id, credential_id, public_key, counter, device_type, backed_up, device_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [data.employeeId, data.credentialId, data.publicKeyBase64, data.counter, data.deviceType, data.backedUp, data.deviceName]
  );
}

export async function listActiveWebAuthnCredentials(employeeId: number): Promise<WebAuthnCredentialRow[]> {
  const res = await query(
    `SELECT * FROM employee_webauthn_credentials WHERE employee_id = $1 AND revoked_at IS NULL ORDER BY created_at ASC`,
    [employeeId]
  );
  return res.rows;
}

export async function findWebAuthnCredentialById(credentialId: string): Promise<WebAuthnCredentialRow | null> {
  const res = await query(
    `SELECT * FROM employee_webauthn_credentials WHERE credential_id = $1 AND revoked_at IS NULL`,
    [credentialId]
  );
  return res.rows[0] || null;
}

export async function updateWebAuthnCounter(credentialId: string, counter: number): Promise<void> {
  await query(
    `UPDATE employee_webauthn_credentials SET counter = $2, last_used_at = now() WHERE credential_id = $1`,
    [credentialId, counter]
  );
}

/** Ownership-scoped (id + employee_id together), same pattern as
 * sessions.ts::deleteById — a credential id from another employee can
 * never be revoked by mistake or by a forged request. */
export async function revokeWebAuthnCredential(id: number, employeeId: number): Promise<boolean> {
  const res = await query(
    `UPDATE employee_webauthn_credentials SET revoked_at = now() WHERE id = $1 AND employee_id = $2 AND revoked_at IS NULL RETURNING id`,
    [id, employeeId]
  );
  return res.rows.length > 0;
}

// ===== Recovery codes =====

export async function replaceRecoveryCodes(employeeId: number, codeHashes: string[]): Promise<number> {
  const res = await query(
    `SELECT MAX(batch_id) AS max FROM employee_recovery_codes WHERE employee_id = $1`,
    [employeeId]
  );
  const nextBatch = (res.rows[0]?.max || 0) + 1;
  // Старые коды (любого предыдущего batch) больше не валидны — регенерация
  // инвалидирует прежний набор целиком, не накапливает их бесконечно.
  await query(`DELETE FROM employee_recovery_codes WHERE employee_id = $1`, [employeeId]);
  for (const hash of codeHashes) {
    await query(
      `INSERT INTO employee_recovery_codes (employee_id, code_hash, batch_id) VALUES ($1,$2,$3)`,
      [employeeId, hash, nextBatch]
    );
  }
  return nextBatch;
}

export async function countActiveRecoveryCodes(employeeId: number): Promise<number> {
  const res = await query(
    `SELECT count(*) FROM employee_recovery_codes WHERE employee_id = $1 AND used_at IS NULL`,
    [employeeId]
  );
  return Number(res.rows[0]?.count || 0);
}

/** Atomic claim — UPDATE...RETURNING in one round trip so two concurrent
 * requests replaying the same recovery code cannot both succeed (the
 * second UPDATE matches zero rows once the first has set used_at). */
export async function consumeRecoveryCode(employeeId: number, codeHash: string): Promise<boolean> {
  const res = await query(
    `UPDATE employee_recovery_codes SET used_at = now()
     WHERE employee_id = $1 AND code_hash = $2 AND used_at IS NULL
     RETURNING id`,
    [employeeId, codeHash]
  );
  return res.rows.length > 0;
}

export async function deleteAllRecoveryCodes(employeeId: number): Promise<void> {
  await query(`DELETE FROM employee_recovery_codes WHERE employee_id = $1`, [employeeId]);
}

// ===== Pending logins (password verified, MFA not yet verified) =====

export async function createPendingLogin(employeeId: number): Promise<string> {
  const token = generateOpaqueToken();
  await query(
    `INSERT INTO mfa_pending_logins (employee_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '5 minutes')`,
    [employeeId, hashOpaqueToken(token)]
  );
  return token;
}

export async function resolvePendingLogin(token: string): Promise<{ id: number; employee_id: number } | null> {
  const res = await query(
    `SELECT id, employee_id FROM mfa_pending_logins WHERE token_hash = $1 AND expires_at > now() AND consumed_at IS NULL`,
    [hashOpaqueToken(token)]
  );
  return res.rows[0] || null;
}

export async function consumePendingLogin(id: number): Promise<void> {
  await query(`UPDATE mfa_pending_logins SET consumed_at = now() WHERE id = $1`, [id]);
}

// ===== WebAuthn ceremony challenges =====

export async function createWebAuthnChallenge(employeeId: number, kind: 'register' | 'authenticate', challenge: string): Promise<void> {
  await query(
    `INSERT INTO mfa_webauthn_challenges (employee_id, kind, challenge, expires_at) VALUES ($1,$2,$3, now() + interval '5 minutes')`,
    [employeeId, kind, challenge]
  );
}

/** Single-use — consumed atomically in the same statement that reads it,
 * so a replayed WebAuthn response (same challenge submitted twice)
 * cannot verify a second time even if the signature itself were replayed. */
export async function consumeWebAuthnChallenge(employeeId: number, kind: 'register' | 'authenticate'): Promise<string | null> {
  const res = await query(
    `UPDATE mfa_webauthn_challenges SET consumed_at = now()
     WHERE id = (
       SELECT id FROM mfa_webauthn_challenges
       WHERE employee_id = $1 AND kind = $2 AND expires_at > now() AND consumed_at IS NULL
       ORDER BY created_at DESC LIMIT 1
     )
     RETURNING challenge`,
    [employeeId, kind]
  );
  return res.rows[0]?.challenge || null;
}

// ===== Step-up tickets =====

export async function createStepUpTicket(employeeId: number, ttlMinutes: number): Promise<string> {
  const token = generateOpaqueToken();
  await query(
    `INSERT INTO mfa_step_up_tickets (employee_id, token_hash, expires_at) VALUES ($1,$2, now() + ($3 || ' minutes')::interval)`,
    [employeeId, hashOpaqueToken(token), String(ttlMinutes)]
  );
  return token;
}

export async function resolveStepUpTicket(employeeId: number, token: string): Promise<boolean> {
  const res = await query(
    `SELECT id FROM mfa_step_up_tickets WHERE employee_id = $1 AND token_hash = $2 AND expires_at > now()`,
    [employeeId, hashOpaqueToken(token)]
  );
  return res.rows.length > 0;
}
