/**
 * Admin Control Center (20.59.0) — capability module for the new
 * /admin/* routes. Kept separate from features/admin/api.ts, which owns
 * a different capability set (branding/orgs/audit/dealers/sectors).
 */
import type {
  AdminOverviewResponse,
  AdminSearchResponse,
  AdminEmployeeDetailResponse,
  AdminEmployeeEditRequest,
  AdminEmployeeRoleChangeRequest,
  AdminStoresListResponse,
  AdminStoreDetailResponse,
  AdminSalesListResponse,
  AdminSaleDetailResponse,
  AdminSaleActionResponse,
  AdminSaleVoidPreviewResponse,
  AdminSaleCorrectStorePreviewResponse,
  AdminSaleMetricCorrectRequest,
  AdminShiftsListResponse,
  AdminShiftDetailResponse,
  AdminShiftActionResponse,
  AdminShiftVoidPreviewResponse,
  AdminShiftCorrectPreviewResponse,
  AdminSchedulesListResponse,
  AdminScheduleDetailResponse,
  AdminScheduleActionResponse,
  AdminScheduleVoidPreviewResponse,
  AdminScheduleCorrectPreviewResponse,
  AdminPlanDetailResponse,
  StepUpTicketResponse,
  AdminFeatureFlagsListResponse,
  AdminFeatureFlagUpsertResponse,
  AdminFeatureFlagDeleteResponse,
  AdminOperationsOverviewResponse
} from '../../../../src/shared/api-types.js';
import { request } from '../../shared/api/http-client.js';

export async function adminGetOverview(headers: Record<string, string>, orgQuery: string): Promise<AdminOverviewResponse> {
  return request(`/admin/overview${orgQuery ? '?' + orgQuery.slice(1) : ''}`, headers);
}

export async function adminSearch(headers: Record<string, string>, term: string, orgQuery: string): Promise<AdminSearchResponse> {
  const params = new URLSearchParams({ q: term });
  return request(`/admin/search?${params.toString()}${orgQuery}`, headers);
}

// ---------- Employees ----------

export async function adminGetEmployee(headers: Record<string, string>, id: number): Promise<AdminEmployeeDetailResponse> {
  return request(`/admin/employees/${id}`, headers);
}

export async function adminEditEmployee(headers: Record<string, string>, id: number, body: AdminEmployeeEditRequest): Promise<{ employee: AdminEmployeeDetailResponse['employee'] }> {
  return request(`/admin/employees/${id}`, headers, { method: 'PATCH', body });
}

export async function adminChangeEmployeeRole(headers: Record<string, string>, id: number, body: AdminEmployeeRoleChangeRequest, stepUpToken?: string): Promise<{ employee: AdminEmployeeDetailResponse['employee'] }> {
  return request(`/admin/employees/${id}/role`, withStepUp(headers, stepUpToken), { method: 'POST', body });
}

export async function adminDeactivateEmployee(headers: Record<string, string>, id: number): Promise<{ employee: AdminEmployeeDetailResponse['employee'] }> {
  return request(`/admin/employees/${id}/deactivate`, headers, { method: 'POST' });
}

export async function adminReactivateEmployee(headers: Record<string, string>, id: number): Promise<{ employee: AdminEmployeeDetailResponse['employee'] }> {
  return request(`/admin/employees/${id}/reactivate`, headers, { method: 'POST' });
}

export async function adminRevokeEmployeeSession(headers: Record<string, string>, employeeId: number, sessionId: number): Promise<{ ok: true }> {
  return request(`/admin/employees/${employeeId}/sessions/${sessionId}`, headers, { method: 'DELETE' });
}

export async function adminRevokeAllEmployeeSessions(headers: Record<string, string>, employeeId: number): Promise<{ ok: true }> {
  return request(`/admin/employees/${employeeId}/sessions/revoke-all`, headers, { method: 'POST' });
}

export async function adminResetEmployeeMfa(headers: Record<string, string>, employeeId: number, stepUpToken: string): Promise<{ ok: true }> {
  return request(`/admin/employees/${employeeId}/mfa/reset`, withStepUp(headers, stepUpToken), { method: 'POST' });
}

export async function adminInitiatePasswordReset(headers: Record<string, string>, employeeId: number): Promise<{ token: string }> {
  return request(`/admin/employees/${employeeId}/password-reset`, headers, { method: 'POST' });
}

// ---------- Stores ----------

export async function adminListStores(headers: Record<string, string>, orgQuery: string): Promise<AdminStoresListResponse> {
  return request(`/admin/stores${orgQuery ? '?' + orgQuery.slice(1) : ''}`, headers);
}

export async function adminGetStore(headers: Record<string, string>, id: string): Promise<AdminStoreDetailResponse> {
  return request(`/admin/stores/${encodeURIComponent(id)}`, headers);
}

export async function adminEditStore(headers: Record<string, string>, id: string, body: Record<string, unknown>): Promise<AdminStoreDetailResponse> {
  return request(`/admin/stores/${encodeURIComponent(id)}`, headers, { method: 'PATCH', body });
}

export async function adminDeactivateStore(headers: Record<string, string>, id: string): Promise<{ ok: true }> {
  return request(`/admin/stores/${encodeURIComponent(id)}/deactivate`, headers, { method: 'POST' });
}

export async function adminReactivateStore(headers: Record<string, string>, id: string): Promise<AdminStoreDetailResponse> {
  return request(`/admin/stores/${encodeURIComponent(id)}/reactivate`, headers, { method: 'POST' });
}

// ---------- Sales correction ----------

export interface AdminSalesSearchParams {
  employeeId?: number;
  storeId?: string;
  from?: string;
  to?: string;
  includeVoided?: boolean;
  limit?: number;
  offset?: number;
}

export async function adminSearchSales(headers: Record<string, string>, orgQuery: string, params: AdminSalesSearchParams): Promise<AdminSalesListResponse> {
  const qs = new URLSearchParams();
  if (params.employeeId) qs.set('employee_id', String(params.employeeId));
  if (params.storeId) qs.set('store_id', params.storeId);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.includeVoided) qs.set('include_voided', '1');
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  const filterQuery = qs.toString();
  const query = filterQuery ? `?${filterQuery}${orgQuery}` : orgQuery ? `?${orgQuery.slice(1)}` : '';
  return request(`/admin/sales${query}`, headers);
}

export async function adminGetSale(headers: Record<string, string>, id: string): Promise<AdminSaleDetailResponse> {
  return request(`/admin/sales/${encodeURIComponent(id)}`, headers);
}

export async function adminPreviewVoidSale(headers: Record<string, string>, id: string): Promise<AdminSaleVoidPreviewResponse> {
  return request(`/admin/sales/${encodeURIComponent(id)}/void/preview`, headers, { method: 'POST' });
}

export async function adminVoidSale(headers: Record<string, string>, id: string, version: number, reason: string): Promise<AdminSaleActionResponse> {
  return request(`/admin/sales/${encodeURIComponent(id)}/void`, headers, { method: 'POST', body: { version, reason } });
}

export async function adminRestoreSale(headers: Record<string, string>, id: string, version: number, reason: string): Promise<AdminSaleActionResponse> {
  return request(`/admin/sales/${encodeURIComponent(id)}/restore`, headers, { method: 'POST', body: { version, reason } });
}

export async function adminCorrectSaleMetric(headers: Record<string, string>, id: string, metric: string, value: number, version: number, reason: string): Promise<AdminSaleDetailResponse> {
  const body: AdminSaleMetricCorrectRequest = { metric, value, version, reason };
  return request(`/admin/sales/${encodeURIComponent(id)}/correct-metric`, headers, { method: 'POST', body });
}

export async function adminPreviewCorrectStore(headers: Record<string, string>, id: string, newStoreId: string): Promise<AdminSaleCorrectStorePreviewResponse> {
  return request(`/admin/sales/${encodeURIComponent(id)}/correct-store/preview`, headers, { method: 'POST', body: { new_store_id: newStoreId } });
}

export async function adminCorrectSaleStore(headers: Record<string, string>, id: string, version: number, newStoreId: string, reason: string, stepUpToken?: string): Promise<AdminSaleActionResponse> {
  return request(`/admin/sales/${encodeURIComponent(id)}/correct-store`, withStepUp(headers, stepUpToken), { method: 'POST', body: { version, new_store_id: newStoreId, reason } });
}

// ---------- Shift corrections ----------

export interface AdminShiftsSearchParams {
  employeeId?: number;
  storeId?: string;
  from?: string;
  to?: string;
  includeVoided?: boolean;
  limit?: number;
  offset?: number;
}

export async function adminSearchShifts(headers: Record<string, string>, orgQuery: string, params: AdminShiftsSearchParams): Promise<AdminShiftsListResponse> {
  const qs = new URLSearchParams();
  if (params.employeeId) qs.set('employee_id', String(params.employeeId));
  if (params.storeId) qs.set('store_id', params.storeId);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.includeVoided) qs.set('include_voided', '1');
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  const filterQuery = qs.toString();
  const query = filterQuery ? `?${filterQuery}${orgQuery}` : orgQuery ? `?${orgQuery.slice(1)}` : '';
  return request(`/admin/shifts${query}`, headers);
}

export async function adminGetShift(headers: Record<string, string>, id: number): Promise<AdminShiftDetailResponse> {
  return request(`/admin/shifts/${id}`, headers);
}

export async function adminPreviewVoidShift(headers: Record<string, string>, id: number): Promise<AdminShiftVoidPreviewResponse> {
  return request(`/admin/shifts/${id}/void/preview`, headers, { method: 'POST' });
}

export async function adminVoidShift(headers: Record<string, string>, id: number, version: number, reason: string): Promise<AdminShiftActionResponse> {
  return request(`/admin/shifts/${id}/void`, headers, { method: 'POST', body: { version, reason } });
}

export async function adminRestoreShift(headers: Record<string, string>, id: number, version: number, reason: string): Promise<AdminShiftActionResponse> {
  return request(`/admin/shifts/${id}/restore`, headers, { method: 'POST', body: { version, reason } });
}

export async function adminPreviewCorrectShift(headers: Record<string, string>, id: number, newStoreId?: string): Promise<AdminShiftCorrectPreviewResponse> {
  return request(`/admin/shifts/${id}/correct/preview`, headers, { method: 'POST', body: { new_store_id: newStoreId } });
}

export async function adminCorrectShift(headers: Record<string, string>, id: number, version: number, opts: { newStoreId?: string; workDate?: string }, reason: string, stepUpToken?: string): Promise<AdminShiftActionResponse> {
  return request(`/admin/shifts/${id}/correct`, withStepUp(headers, stepUpToken), { method: 'POST', body: { version, new_store_id: opts.newStoreId, work_date: opts.workDate, reason } });
}

// ---------- Schedule corrections ----------

export interface AdminSchedulesSearchParams {
  employeeId?: number;
  storeId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export async function adminSearchSchedules(headers: Record<string, string>, orgQuery: string, params: AdminSchedulesSearchParams): Promise<AdminSchedulesListResponse> {
  const qs = new URLSearchParams();
  if (params.employeeId) qs.set('employee_id', String(params.employeeId));
  if (params.storeId) qs.set('store_id', params.storeId);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  const filterQuery = qs.toString();
  const query = filterQuery ? `?${filterQuery}${orgQuery}` : orgQuery ? `?${orgQuery.slice(1)}` : '';
  return request(`/admin/schedules${query}`, headers);
}

export async function adminGetSchedule(headers: Record<string, string>, id: number): Promise<AdminScheduleDetailResponse> {
  return request(`/admin/schedules/${id}`, headers);
}

export async function adminPreviewVoidSchedule(headers: Record<string, string>, id: number): Promise<AdminScheduleVoidPreviewResponse> {
  return request(`/admin/schedules/${id}/void/preview`, headers, { method: 'POST' });
}

export async function adminVoidSchedule(headers: Record<string, string>, id: number, version: number, reason: string): Promise<AdminScheduleActionResponse> {
  return request(`/admin/schedules/${id}/void`, headers, { method: 'POST', body: { version, reason } });
}

export async function adminPreviewCorrectSchedule(headers: Record<string, string>, id: number, workDate?: string): Promise<AdminScheduleCorrectPreviewResponse> {
  return request(`/admin/schedules/${id}/correct/preview`, headers, { method: 'POST', body: { work_date: workDate } });
}

export async function adminCorrectSchedule(headers: Record<string, string>, id: number, version: number, opts: { storeId?: string; workDate?: string; hours?: number }, reason: string): Promise<AdminScheduleActionResponse> {
  return request(`/admin/schedules/${id}/correct`, headers, { method: 'POST', body: { version, store_id: opts.storeId, work_date: opts.workDate, hours: opts.hours, reason } });
}

// ---------- Plan corrections ----------

export async function adminGetEmployeePlan(headers: Record<string, string>, id: number): Promise<AdminPlanDetailResponse> {
  return request(`/admin/plans/employees/${id}`, headers);
}

export async function adminCorrectEmployeePlanMetric(headers: Record<string, string>, id: number, metric: string, value: number, version: number, reason: string): Promise<AdminPlanDetailResponse> {
  return request(`/admin/plans/employees/${id}/correct-metric`, headers, { method: 'POST', body: { metric, value, version, reason } });
}

export async function adminGetStorePlan(headers: Record<string, string>, id: number): Promise<AdminPlanDetailResponse> {
  return request(`/admin/plans/stores/${id}`, headers);
}

export async function adminCorrectStorePlanMetric(headers: Record<string, string>, id: number, metric: string, value: number, version: number, reason: string): Promise<AdminPlanDetailResponse> {
  return request(`/admin/plans/stores/${id}/correct-metric`, headers, { method: 'POST', body: { metric, value, version, reason } });
}

// ---------- Feature flags ----------

export async function adminGetFeatureFlags(headers: Record<string, string>): Promise<AdminFeatureFlagsListResponse> {
  return request('/admin/feature-flags', headers);
}

export async function adminUpsertFeatureFlag(headers: Record<string, string>, key: string, orgId: string | null, enabled: boolean, description: string | null): Promise<AdminFeatureFlagUpsertResponse> {
  return request(`/admin/feature-flags/${encodeURIComponent(key)}`, headers, { method: 'PUT', body: { org_id: orgId, enabled, description } });
}

export async function adminDeleteFeatureFlag(headers: Record<string, string>, key: string, orgId: string | null): Promise<AdminFeatureFlagDeleteResponse> {
  const qs = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
  return request(`/admin/feature-flags/${encodeURIComponent(key)}${qs}`, headers, { method: 'DELETE' });
}

// ---------- Operations Center ----------

export async function adminGetOperationsOverview(headers: Record<string, string>): Promise<AdminOperationsOverviewResponse> {
  return request('/admin/operations-overview', headers);
}

// ---------- Step-up MFA ticket (ADR-009) ----------

export async function issueStepUpTicket(headers: Record<string, string>, method: 'totp' | 'recovery_code', code: string): Promise<StepUpTicketResponse> {
  return request('/auth/mfa/step-up', headers, { method: 'POST', body: { method, code } });
}

function withStepUp(headers: Record<string, string>, token?: string): Record<string, string> {
  return token ? { ...headers, 'X-Step-Up-Token': token } : headers;
}
