import type {
  RegisterPhoneRequest,
  RegisterPhoneResponse,
  LoginRequest,
  LoginResponse,
  LogoutResponse,
  ConsumeResetRequest,
  ConsumeResetResponse,
  MfaStatusResponse,
  MfaTotpEnrollment,
  ListSessionsResponse,
  RevokeSessionResponse,
  RevokeOtherSessionsResponse
} from '../../../../src/shared/api-types.js';
import { request } from '../../shared/api/http-client.js';


// ---------- Не-Telegram вход (20.37) ----------
export async function registerPhone(headers: Record<string, string>, body: RegisterPhoneRequest): Promise<RegisterPhoneResponse> {
  return request('/auth/register', headers, { method: 'POST', body });
}

export async function loginPhone(headers: Record<string, string>, body: LoginRequest): Promise<LoginResponse> {
  return request('/auth/login', headers, { method: 'POST', body });
}

export async function logoutPhone(headers: Record<string, string>): Promise<LogoutResponse> {
  return request('/auth/logout', headers, { method: 'POST', body: {} });
}

export async function consumePasswordReset(
  headers: Record<string, string>,
  token: string,
  body: ConsumeResetRequest
): Promise<ConsumeResetResponse> {
  return request(`/auth/reset/${encodeURIComponent(token)}`, headers, { method: 'POST', body });
}


// ---------- MFA (20.52.1, Auth Assurance Hardening) ----------
export async function loginMfa(
  headers: Record<string, string>,
  body: { mfa_token: string; method: 'totp' | 'recovery_code'; code: string }
): Promise<LoginResponse> {
  return request('/auth/login/mfa', headers, { method: 'POST', body });
}

export async function getMfaStatus(headers: Record<string, string>): Promise<MfaStatusResponse> {
  return request('/auth/mfa/status', headers);
}

export async function mfaTotpEnroll(headers: Record<string, string>): Promise<MfaTotpEnrollment> {
  return request('/auth/mfa/totp/enroll', headers, { method: 'POST', body: {} });
}

export async function mfaTotpConfirm(headers: Record<string, string>, code: string): Promise<{ ok: true }> {
  return request('/auth/mfa/totp/confirm', headers, { method: 'POST', body: { code } });
}

export async function mfaRecoveryCodesGenerate(headers: Record<string, string>): Promise<{ ok: true; codes: string[] }> {
  return request('/auth/mfa/recovery-codes/generate', headers, { method: 'POST', body: {} });
}


// ---------- Telegram AAL2 grant (20.53.0) ----------
export async function mfaTelegramVerify(
  headers: Record<string, string>,
  body: { method: 'totp' | 'recovery_code'; code: string }
): Promise<{ ok: true }> {
  return request('/auth/mfa/telegram/verify', headers, { method: 'POST', body });
}


// ---------- Активные сессии (20.48.0, Web Security & Trust Layer) ----------
export async function listSessions(headers: Record<string, string>): Promise<ListSessionsResponse> {
  return request('/auth/sessions', headers);
}

export async function revokeSession(headers: Record<string, string>, id: number): Promise<RevokeSessionResponse> {
  return request(`/auth/sessions/${id}`, headers, { method: 'DELETE' });
}

export async function revokeOtherSessions(headers: Record<string, string>): Promise<RevokeOtherSessionsResponse> {
  return request('/auth/sessions/revoke-others', headers, { method: 'POST', body: {} });
}
