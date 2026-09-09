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

export async function getAccessRequests(headers: Record<string, string>): Promise<AccessRequestsListResponse> {
  return request('/access/requests', headers);
}

export async function approveAccessRequest(
  headers: Record<string, string>,
  id: number,
  body: ApproveAccessRequest
): Promise<ApproveAccessResponse> {
  return request(`/access/requests/${id}/approve`, headers, { method: 'POST', body });
}

export async function rejectAccessRequest(headers: Record<string, string>, id: number): Promise<unknown> {
  return request(`/access/requests/${id}/reject`, headers, { method: 'POST', body: {} });
}
