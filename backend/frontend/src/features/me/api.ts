import type {
  MeResponse,
  BindMeRequest,
  BindMeResponse,
  LinkPhoneRequest,
  LinkPhoneResponse,
  MeDayResponse,
  MyInsightResponse,
  SelfStatsResponse
} from '../../../../src/shared/api-types.js';
import { request, requestUpload, requestBlob } from '../../shared/api/http-client.js';


// ---------- 20.7.0: оставшиеся 13 файлов эпохи 20, одним заходом ----------

export async function getMe(headers: Record<string, string>): Promise<MeResponse> {
  return request('/me', headers);
}

export async function bindMe(headers: Record<string, string>, body: BindMeRequest): Promise<BindMeResponse> {
  return request('/me/bind', headers, { method: 'POST', body });
}

export async function linkPhone(headers: Record<string, string>, body: LinkPhoneRequest): Promise<LinkPhoneResponse> {
  return request('/me/link-phone', headers, { method: 'POST', body });
}

export async function getMyDay(headers: Record<string, string>): Promise<MeDayResponse> {
  return request('/me/day', headers);
}

export async function getMyInsight(headers: Record<string, string>): Promise<MyInsightResponse> {
  return request('/me/insight', headers);
}

export async function getSelfStats(headers: Record<string, string>): Promise<SelfStatsResponse> {
  return request('/me/self-stats', headers);
}

export async function uploadAvatar(headers: Record<string, string>, form: FormData): Promise<unknown> {
  return requestUpload('/me/avatar', headers, form);
}

// GET /avatars/:id now requires auth + same-org (hotfix — was a fully
// public, sequentially-guessable IDOR, see git history on
// api/routes/me/avatar.ts). A bare <img src> can't send auth headers, so
// callers must fetch the blob first and set it via URL.createObjectURL —
// same pattern as chat attachments (features/chat/api.ts::getChatAttachment).
export async function getAvatar(headers: Record<string, string>, employeeId: number): Promise<Blob> {
  return requestBlob(`/avatars/${employeeId}`, headers);
}
