import type {
  GenerateScheduleDraftRequest,
  GenerateScheduleDraftResponse,
  ScheduleDraftViewResponse,
  ApplyScheduleDraftResponse,
  StaffingRequirementsListResponse,
  SaveStaffingRequirementsRequest
} from '../../../../src/shared/api-types.js';
import { request } from '../../shared/api/http-client.js';

export async function generateScheduleDraft(
  headers: Record<string, string>,
  body: GenerateScheduleDraftRequest
): Promise<GenerateScheduleDraftResponse> {
  return request('/schedule-drafts/generate', headers, { method: 'POST', body });
}

export async function getScheduleDraftById(
  headers: Record<string, string>,
  draftId: number,
  orgQuery: string
): Promise<ScheduleDraftViewResponse> {
  return request(`/schedule-drafts/${draftId}${orgQuery}`, headers);
}

export async function applyScheduleDraft(
  headers: Record<string, string>,
  draftId: number,
  body: { org_id?: string; replace?: boolean }
): Promise<ApplyScheduleDraftResponse> {
  return request(`/schedule-drafts/${draftId}/apply`, headers, { method: 'POST', body });
}

export async function getStaffingRequirements(
  headers: Record<string, string>,
  storeId: string,
  orgQuery: string
): Promise<StaffingRequirementsListResponse> {
  return request(`/stores/${storeId}/staffing-requirements${orgQuery}`, headers);
}

export async function saveStaffingRequirements(
  headers: Record<string, string>,
  storeId: string,
  body: SaveStaffingRequirementsRequest
): Promise<StaffingRequirementsListResponse> {
  return request(`/stores/${storeId}/staffing-requirements`, headers, { method: 'PUT', body });
}
