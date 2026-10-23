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
  AdminClearStoreMonthPreviewResponse,
  AdminClearStoreMonthResponse,
  AdminPlanDetailResponse,
  StepUpTicketResponse,
  AdminFeatureFlagsListResponse,
  AdminFeatureFlagUpsertResponse,
  AdminFeatureFlagDeleteResponse,
  AdminOperationsOverviewResponse,
  AdminSheetImportPendingListResponse,
  AdminSheetImportResolveResponse,
  MirandaPendingBindingsListResponse,
  MirandaApproveBindingResponse,
  MirandaRevokeBindingResponse,
  MirandaCorporateAccountsListResponse,
  MirandaAvailableAccountsResponse,
  MirandaGrantAccountResponse,
  MirandaSetDeviceExclusiveResponse,
  MirandaCreateAccountResponse,
  MirandaContactGroupsListResponse,
  MirandaCreateContactGroupResponse,
  MirandaContactGroupMutationResponse
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

// org-switcher-aware (20.78.0) — тот же паттерн, что adminEditStore/adminGetStore:
// без org_id requireEmployeeInOrg сверял сотрудника с СВОЕЙ сетью admin'а,
// и смена роли (в т.ч. на admin) в переключённой сети падала 403.
export async function adminChangeEmployeeRole(headers: Record<string, string>, id: number, body: AdminEmployeeRoleChangeRequest, stepUpToken?: string, orgId?: string | null): Promise<{ employee: AdminEmployeeDetailResponse['employee'] }> {
  const payload = orgId ? { ...body, org_id: orgId } : body;
  return request(`/admin/employees/${id}/role`, withStepUp(headers, stepUpToken), { method: 'POST', body: payload });
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

// org-switcher-aware (20.76.0 fix): раньше эти 4 функции не передавали
// org_id вообще, resolveViewOrgId() на бэкенде тихо откатывался на
// СОБСТВЕННУЮ сеть админа — список точек (adminListStores, ниже) уже
// уважал переключатель сети, а клик по точке другой сети (не своей)
// падал 404 "не удалось загрузить точку", потому что detail/edit/
// деактивация искали точку не в той сети.
export async function adminGetStore(headers: Record<string, string>, id: string, orgQuery: string): Promise<AdminStoreDetailResponse> {
  return request(`/admin/stores/${encodeURIComponent(id)}${orgQuery ? '?' + orgQuery.slice(1) : ''}`, headers);
}

export async function adminEditStore(headers: Record<string, string>, id: string, body: Record<string, unknown>, orgId: string | null): Promise<AdminStoreDetailResponse> {
  return request(`/admin/stores/${encodeURIComponent(id)}`, headers, { method: 'PATCH', body: orgId ? { ...body, org_id: orgId } : body });
}

export async function adminDeactivateStore(headers: Record<string, string>, id: string, orgId: string | null): Promise<{ ok: true }> {
  return request(`/admin/stores/${encodeURIComponent(id)}/deactivate`, headers, { method: 'POST', body: orgId ? { org_id: orgId } : undefined });
}

export async function adminReactivateStore(headers: Record<string, string>, id: string, orgId: string | null): Promise<AdminStoreDetailResponse> {
  return request(`/admin/stores/${encodeURIComponent(id)}/reactivate`, headers, { method: 'POST', body: orgId ? { org_id: orgId } : undefined });
}

// 20.77.0 — перенос точки между сетями/дилерами. Бэкенд-роут
// (POST /admin/stores/:id/move) существовал с 20.72.0, фронтенда не
// было нигде.
export async function adminMoveStore(headers: Record<string, string>, id: string, toOrgId: string, orgId: string | null): Promise<AdminStoreDetailResponse> {
  return request(`/admin/stores/${encodeURIComponent(id)}/move`, headers, { method: 'POST', body: orgId ? { toOrgId, org_id: orgId } : { toOrgId } });
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

export async function adminPreviewClearStoreMonth(headers: Record<string, string>, storeId: string, month: string): Promise<AdminClearStoreMonthPreviewResponse> {
  const qs = new URLSearchParams({ store_id: storeId, month });
  return request(`/admin/schedules/clear-store-month/preview?${qs.toString()}`, headers);
}

export async function adminClearStoreMonth(headers: Record<string, string>, storeId: string, month: string, reason: string): Promise<AdminClearStoreMonthResponse> {
  return request('/admin/schedules/clear-store-month', headers, { method: 'POST', body: { store_id: storeId, month, reason } });
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

// ---------- Sheet schedule import review ----------

export async function adminGetSheetImportPending(headers: Record<string, string>): Promise<AdminSheetImportPendingListResponse> {
  return request('/admin/sheet-import/pending', headers);
}

export async function adminConfirmSheetImportPending(headers: Record<string, string>, id: number, employeeId: number): Promise<AdminSheetImportResolveResponse> {
  return request(`/admin/sheet-import/pending/${id}/confirm`, headers, { method: 'POST', body: { employee_id: employeeId } });
}

export async function adminRejectSheetImportPending(headers: Record<string, string>, id: number): Promise<AdminSheetImportResolveResponse> {
  return request(`/admin/sheet-import/pending/${id}/reject`, headers, { method: 'POST' });
}

// ---------- Operations Center ----------

export async function adminGetOperationsOverview(headers: Record<string, string>): Promise<AdminOperationsOverviewResponse> {
  return request('/admin/operations-overview', headers);
}

// ---------- T2 Miranda — устройства/корпоративные аккаунты ----------

export async function adminListMirandaDevices(headers: Record<string, string>, orgQuery: string): Promise<MirandaPendingBindingsListResponse> {
  return request(`/miranda/devices${orgQuery ? '?' + orgQuery.slice(1) : ''}`, headers);
}

export async function adminApproveMirandaDevice(headers: Record<string, string>, bindingId: number, stepUpToken?: string): Promise<MirandaApproveBindingResponse> {
  return request(`/miranda/devices/${bindingId}/approve`, withStepUp(headers, stepUpToken), { method: 'POST' });
}

export async function adminRevokeMirandaDevice(headers: Record<string, string>, bindingId: number): Promise<MirandaRevokeBindingResponse> {
  return request(`/miranda/devices/${bindingId}/revoke`, headers, { method: 'POST' });
}

export async function adminListMirandaCorporateAccounts(headers: Record<string, string>, includeInactive = false, orgQuery = ''): Promise<MirandaCorporateAccountsListResponse> {
  const qs = new URLSearchParams();
  if (includeInactive) qs.set('include_inactive', '1');
  if (orgQuery) qs.set('org_id', orgQuery.slice(1));
  const query = qs.toString();
  return request(`/miranda/accounts${query ? '?' + query : ''}`, headers);
}

// §C плана (глобальная админка) — деактивация/восстановление (не
// удаление) ненужного Miranda-аккаунта. Бэкенд существовал с 20.72.0,
// фронтенда не было нигде (ни веб, ни native) — найдено как пробел
// 20.76.0, "нативный клиент всегда должен соответствовать вебу".
export async function adminDeactivateMirandaAccount(headers: Record<string, string>, corporateAccountId: number): Promise<{ ok: true }> {
  return request(`/miranda/accounts/${corporateAccountId}/deactivate`, headers, { method: 'POST' });
}

export async function adminReactivateMirandaAccount(headers: Record<string, string>, corporateAccountId: number): Promise<{ ok: true }> {
  return request(`/miranda/accounts/${corporateAccountId}/reactivate`, headers, { method: 'POST' });
}

export async function adminCreateMirandaAccount(
  headers: Record<string, string>,
  employeeId: number,
  storeId: string | null,
  displayLabel: string | null
): Promise<MirandaCreateAccountResponse> {
  return request('/miranda/accounts', headers, { method: 'POST', body: { employeeId, storeId, displayLabel } });
}

// Этап B (вариант B) — аккаунт точки/кассы: собственный вход по телефону+паролю.
export async function adminCreateMirandaPointAccount(
  headers: Record<string, string>,
  phone: string,
  password: string,
  accountName: string,
  storeId: string | null
): Promise<MirandaCreateAccountResponse> {
  return request('/miranda/accounts', headers, { method: 'POST', body: { phone, password, accountName, storeId } });
}

export async function adminListMirandaAvailableAccounts(headers: Record<string, string>): Promise<MirandaAvailableAccountsResponse> {
  return request('/miranda/accounts/available', headers);
}

export async function adminGrantMirandaAccount(headers: Record<string, string>, adminEmployeeId: number, corporateAccountId: number): Promise<MirandaGrantAccountResponse> {
  return request('/miranda/admin-grants', headers, { method: 'POST', body: { adminEmployeeId, corporateAccountId } });
}

export async function adminSetMirandaAccountDeviceExclusive(
  headers: Record<string, string>,
  corporateAccountId: number,
  deviceExclusive: boolean
): Promise<MirandaSetDeviceExclusiveResponse> {
  return request(`/miranda/accounts/${corporateAccountId}/device-exclusive`, headers, { method: 'PATCH', body: { deviceExclusive } });
}

/** Admin Control Center — переименование любого корпоративного аккаунта
 * (PATCH /miranda/accounts/:id, 20.78.4): displayLabel=null возвращает
 * дефолтное имя (сотрудник/account_name). */
export async function adminRenameMirandaAccount(
  headers: Record<string, string>,
  corporateAccountId: number,
  displayLabel: string | null
): Promise<{ ok: true }> {
  return request(`/miranda/accounts/${corporateAccountId}`, headers, { method: 'PATCH', body: { displayLabel } });
}

// ---------- T2 Miranda — группы контактов (общие для дилера) ----------

export async function adminListMirandaGroups(headers: Record<string, string>, orgQuery = ''): Promise<MirandaContactGroupsListResponse> {
  return request(`/miranda/admin/groups${orgQuery ? '?' + orgQuery.slice(1) : ''}`, headers);
}

export async function adminCreateMirandaGroup(
  headers: Record<string, string>,
  name: string,
  orgId: string | null,
  parentGroupId: number | null = null
): Promise<MirandaCreateContactGroupResponse> {
  const body: Record<string, unknown> = { name };
  if (orgId) body.orgId = orgId;
  if (parentGroupId != null) body.parentGroupId = parentGroupId;
  return request('/miranda/groups', headers, { method: 'POST', body });
}

export async function adminRenameMirandaGroup(
  headers: Record<string, string>,
  groupId: number,
  name: string
): Promise<MirandaContactGroupMutationResponse> {
  return request(`/miranda/groups/${groupId}`, headers, { method: 'PATCH', body: { name } });
}

export async function adminDeleteMirandaGroup(
  headers: Record<string, string>,
  groupId: number
): Promise<MirandaContactGroupMutationResponse> {
  return request(`/miranda/groups/${groupId}`, headers, { method: 'DELETE' });
}

export async function adminAddMirandaGroupMember(
  headers: Record<string, string>,
  groupId: number,
  corporateAccountId: number
): Promise<MirandaContactGroupMutationResponse> {
  return request(`/miranda/groups/${groupId}/members`, headers, { method: 'POST', body: { corporateAccountId } });
}

export async function adminRemoveMirandaGroupMember(
  headers: Record<string, string>,
  groupId: number,
  corporateAccountId: number
): Promise<MirandaContactGroupMutationResponse> {
  return request(`/miranda/groups/${groupId}/members/${corporateAccountId}`, headers, { method: 'DELETE' });
}

// ---------- Step-up MFA ticket (ADR-009) ----------

export async function issueStepUpTicket(headers: Record<string, string>, method: 'totp' | 'recovery_code', code: string): Promise<StepUpTicketResponse> {
  return request('/auth/mfa/step-up', headers, { method: 'POST', body: { method, code } });
}

function withStepUp(headers: Record<string, string>, token?: string): Record<string, string> {
  return token ? { ...headers, 'X-Step-Up-Token': token } : headers;
}
