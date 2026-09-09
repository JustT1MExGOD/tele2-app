import type {
  GenerateEmployeeMonthPlanDraftRequest,
  GenerateEmployeeMonthPlanDraftResponse,
  EmployeeMonthPlanDraftViewResponse,
  ApplyEmployeeMonthPlanDraftResponse
} from '../../../../src/shared/api-types.js';
import { request } from '../../shared/api/http-client.js';

export async function generateEmployeeMonthPlanDrafts(
  headers: Record<string, string>,
  body: GenerateEmployeeMonthPlanDraftRequest
): Promise<GenerateEmployeeMonthPlanDraftResponse> {
  return request('/plans/employees/month-drafts', headers, { method: 'POST', body });
}

export async function getLatestEmployeeMonthPlanDraft(
  headers: Record<string, string>,
  month: string,
  orgQuery: string
): Promise<EmployeeMonthPlanDraftViewResponse> {
  return request(`/plans/employees/month-drafts/latest?month=${month}${orgQuery}`, headers);
}

export async function getEmployeeMonthPlanDraftById(
  headers: Record<string, string>,
  draftId: number,
  orgQuery: string
): Promise<EmployeeMonthPlanDraftViewResponse> {
  return request(`/plans/employees/month-drafts/${draftId}${orgQuery}`, headers);
}

export async function applyEmployeeMonthPlanDraft(
  headers: Record<string, string>,
  draftId: number,
  body: { org_id?: string }
): Promise<ApplyEmployeeMonthPlanDraftResponse> {
  return request(`/plans/employees/month-drafts/${draftId}/apply`, headers, { method: 'POST', body });
}
