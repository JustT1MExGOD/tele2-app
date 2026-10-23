import type {
  AccessStatusResponse,
  AccessOrgsResponse,
  AccessDirectoryResponse,
  SubmitAccessRequestRequest,
  SubmitAccessRequestResponse,
  AccessRequestsListResponse,
  ApproveAccessRequest,
  ApproveAccessResponse
} from '../../../../src/shared/api-types.js';
import { request } from '../../shared/api/http-client.js';

export async function getAccessStatus(headers: Record<string, string>): Promise<AccessStatusResponse> {
  return request('/access/status', headers);
}

export async function getAccessOrgs(headers: Record<string, string>): Promise<AccessOrgsResponse> {
  return request('/access/orgs', headers);
}


// queryString уже полностью собран вызывающим кодом (пусто или "?org_id=...").
export async function getAccessDirectory(
  headers: Record<string, string>,
  queryString: string
): Promise<AccessDirectoryResponse> {
  return request(`/access/employees-directory${queryString}`, headers);
}

export async function submitAccessRequest(
  headers: Record<string, string>,
  body: SubmitAccessRequestRequest
): Promise<SubmitAccessRequestResponse> {
  return request('/access/request', headers, { method: 'POST', body });
}

// org-switcher-aware (20.77.0 fix) — раньше ни одна из этих 3 функций не
// передавала org_id вообще: список заявок молча показывал только свою
// сеть независимо от переключателя, а approve/reject заявки другой сети
// падали 403 forbidden (бэкенд сверяет effective_org_id заявки с
// resolveViewOrgId(), который без override откатывается на СВОЮ сеть
// админа) — тот же класс бага, что уже чинили на «Точках» (stores.ts).
export async function getAccessRequests(headers: Record<string, string>, orgQuery: string): Promise<AccessRequestsListResponse> {
  return request(`/access/requests${orgQuery ? '?' + orgQuery.slice(1) : ''}`, headers);
}

export async function approveAccessRequest(
  headers: Record<string, string>,
  id: number,
  body: ApproveAccessRequest,
  orgId: string | null
): Promise<ApproveAccessResponse> {
  return request(`/access/requests/${id}/approve`, headers, { method: 'POST', body: orgId ? { ...body, org_id: orgId } : body });
}

export async function rejectAccessRequest(headers: Record<string, string>, id: number, orgId: string | null): Promise<unknown> {
  return request(`/access/requests/${id}/reject`, headers, { method: 'POST', body: orgId ? { org_id: orgId } : {} });
}
