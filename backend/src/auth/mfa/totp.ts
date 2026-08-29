/**
 * TOTP (RFC 6238) через otplib (vetted, maintained — §0 запрещает
 * писать OTP-примитивы самостоятельно). otplib v13's top-level API
 * defaults `crypto`/`base32` plugins to `NobleCryptoPlugin`/
 * `ScureBase32Plugin` (@noble/hashes, @scure/base — audited, tiny, no
 * native deps) — не выбираем плагины вручную, дефолты уже корректны.
 *
 * Secret хранится Base32-строкой (совместимо с Google Authenticator и
 * аналогами), защищается envelope encryption (data/repositories/mfa.ts),
 * никогда сырым текстом в БД.
 */
import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import * as mfaRepo from '../../data/repositories/mfa.js';

const ISSUER = 'T2 Sales';
/** RFC 6238 рекомендует не расширять окно верификации бездумно — ±30с
 * (один шаг в каждую сторону при period=30) покрывает обычный transmission
 * delay/небольшой рассинхрон часов, не открывает окно для полноценного
 * подбора соседних кодов. */
const EPOCH_TOLERANCE: [number, number] = [30, 30];

export interface TotpEnrollment {
  secret: string;
  otpauthUri: string;
  qrCodeDataUrl: string;
}

/** Начинает/перезапускает enrollment — секрет сохраняется, но НЕ активен
 * (confirmed_at остаётся NULL) пока владелец не подтвердит его валидным
 * кодом через confirmTotpEnrollment(). Незавершённый enrollment не
 * должен удовлетворять MFA-политике (§5 инвариант). */
export async function startTotpEnrollment(employeeId: number, label: string): Promise<TotpEnrollment> {
  const secret = generateSecret();
  await mfaRepo.upsertPendingTotp(employeeId, secret);
  const otpauthUri = generateURI({ issuer: ISSUER, label, secret });
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUri);
  return { secret, otpauthUri, qrCodeDataUrl };
}

/** Подтверждает enrollment — обязателен валидный код ДО того, как TOTP
 * начинает считаться настроенным (§5: "Enrollment must require
 * confirmation... unconfirmed TOTP enrollments не satisfy MFA policy"). */
export async function confirmTotpEnrollment(employeeId: number, code: string): Promise<boolean> {
  const stored = await mfaRepo.getTotpSecret(employeeId);
  if (!stored || stored.confirmed) return false;
  const result = await verifyTotpCode(employeeId, code, stored.secret, stored.lastTimeStep);
  if (!result) return false;
  await mfaRepo.confirmTotp(employeeId);
  return true;
}

export async function isTotpConfirmed(employeeId: number): Promise<boolean> {
  const stored = await mfaRepo.getTotpSecret(employeeId);
  return !!stored?.confirmed;
}

/** Верификация с replay-защитой — принятый timeStep запоминается и не
 * может быть принят повторно (afterTimeStep), даже если тот же 6-значный
 * код перехвачен и переигран в пределах того же/более раннего окна. */
export async function verifyConfirmedTotp(employeeId: number, code: string): Promise<boolean> {
  const stored = await mfaRepo.getTotpSecret(employeeId);
  if (!stored || !stored.confirmed) return false;
  return verifyTotpCode(employeeId, code, stored.secret, stored.lastTimeStep);
}

async function verifyTotpCode(employeeId: number, code: string, secret: string, lastTimeStep: number | null): Promise<boolean> {
  const token = String(code || '').trim();
  if (!/^\d{6,8}$/.test(token)) return false;
  const result = await verify({
    secret,
    token,
    epochTolerance: EPOCH_TOLERANCE,
    afterTimeStep: lastTimeStep ?? undefined
  });
  // discriminated union — только TOTP-ветка (не HOTP) несёт `timeStep`,
  // но этот модуль всегда вызывает verify() без strategy:'hotp', так что
  // валидный результат здесь гарантированно TOTP-shaped.
  if (!result.valid || !('timeStep' in result)) return false;
  await mfaRepo.recordTotpUse(employeeId, result.timeStep);
  return true;
}

export async function disableTotp(employeeId: number): Promise<void> {
  await mfaRepo.deleteTotp(employeeId);
}
