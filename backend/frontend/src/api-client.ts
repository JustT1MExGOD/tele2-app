/**
 * Typed API client (20.0.0+, Frontend Foundation). Собирается Vite'ом в
 * единый classic-script бандл (см. vite.config.ts — формат iife, не
 * es/umd) и подключается в index.html ДО 01-core.js как
 * /dist/api-client.bundle.js.
 *
 * Растёт по мере миграции очередного frontend-файла на TypeScript (см.
 * README §22): 20.0.0 — /org/stores, /metrics (01-core.js); 20.1.0 —
 * промокоды РТК (12-promos.js); 20.2.0 — касса + кастомные метрики
 * (09-cash-metrics.js); 20.3.0 — сводка по сети (19-reports.js); 20.4.0 —
 * алерты (17-alerts.js); 20.5.0 — задачи (15-tasks.js); 20.6.0 — Command
 * Center (14-command-center.js); 20.7.0 — все оставшиеся 13 файлов эпохи
 * 20 одним заходом (02–13, 16, 18).
 *
 * Сознательно бросает на не-ok/сетевой ошибке, не глотает и не
 * подставляет фолбэк сам — это остаётся ответственностью вызывающего
 * кода (легаси-файлы уже оборачивают вызовы в try/catch с собственными
 * фолбэками, поведение снаружи не меняется).
 */
import type {
  OrgStoresResponse,
  MetricsResponse,
  PromosListResponse,
  PromoCard,
  CreatePromoRequest,
  CreatePromoResponse,
  PromoActionResponse,
  CashTableResponse,
  CashRow,
  SaveCashRequest,
  CreateMetricRequest,
  CreateMetricResponse,
  DeleteMetricResponse,
  SendDigestRequest,
  SendDigestResponse,
  AlertsListResponse,
  ChangeAlertStatusRequest,
  ChangeAlertStatusResponse,
  EffectivenessSummaryResponse,
  MarkAlertReadResponse,
  TasksListResponse,
  TaskDetailResponse,
  ChangeTaskStatusRequest,
  ChangeTaskStatusResponse,
  AddTaskCommentRequest,
  AddTaskCommentResponse,
  EmployeesListResponse,
  CreateTaskRequest,
  CreateTaskResponse,
  CommandCenterResponse,
  MeResponse,
  BindMeRequest,
  BindMeResponse,
  MeDayResponse,
  SchedulesListResponse,
  ScheduleMonthResponse,
  SaveScheduleBulkRequest,
  SaveScheduleBulkResponse,
  PlansTemplateResponse,
  MonthSummaryTableResponse,
  EmployeeMonthPlanResponse,
  SaveMonthPlanRequest,
  StoreDailyPlansResponse,
  StoreMonthPlanResponse,
  BfqListResponse,
  BfqEmployeeResponse,
  SaveBfqManualRequest,
  AccessStatusResponse,
  AccessOrgsResponse,
  AccessDirectoryResponse,
  SubmitAccessRequestRequest,
  SubmitAccessRequestResponse,
  AccessRequestsListResponse,
  ApproveAccessRequest,
  ApproveAccessResponse,
  SupervisorDashboardResponse,
  SupervisorHealthResponse,
  SalesListResponse,
  CreateSaleRequest,
  SaleRow,
  SalesHistoryResponse,
  ShiftOpenRequest,
  ShiftOpenResponse,
  ShiftCloseRequest,
  ShiftCloseResponse,
  ShiftCurrentResponse,
  SalesParseRequest,
  SalesParseResponse,
  SalesQuickRequest,
  SalesQuickResponse,
  FaqListResponse,
  MyTicketsResponse,
  AdminTicketsListResponse,
  AdminTicketsSlaResponse,
  CreateTicketRequest,
  CreateTicketResponse,
  TicketReplyRequest,
  TicketReplyResponse,
  TutorialCompleteRequest,
  StatsDailyResponse,
  DashboardResponse,
  EmployeeProgressResponse,
  MyInsightResponse,
  SelfStatsResponse,
  BrandingResponse,
  OrgsListResponse,
  AuditListResponse,
  UpsertOrgRequest,
  UpsertOrgResponse,
  HeatmapPreciseResponse,
  ForecastResponse,
  StaffingHintsResponse,
  AnnouncementsListResponse,
  CreateAnnouncementRequest,
  CreateAnnouncementResponse,
  AnnouncementReadsResponse,
  ReportDayResponse,
  WhatIfRequest,
  WhatIfResponse,
  WhatIfApplyResponse,
  StoreProfileResponse,
  EmployeeProfileResponse,
  CreateEmployeeRequest,
  CreateEmployeeResponse,
  CreateStoreRequest,
  NetworkLiveResponse
} from '../../src/shared/api-types.js';
import type { StoreRecord } from '../../src/data/repositories/stores.js';

/**
 * Бэкенд по всему API (глобальный setErrorHandler, 19.15.0) системно
 * кладёт машинный код в error и человекочитаемый текст в message
 * ({error:'locked', message:'Базовую метрику нельзя удалить'}) — на
 * не-ok разбираем тело и бросаем message первым (не error), иначе toast
 * показал бы код вместо текста (09-cash-metrics.js::saveMetric/
 * deleteMetric уже так делали до миграции — j.message || j.error).
 */
async function request<T>(
  path: string,
  headers: Record<string, string>,
  init?: { method: string; body?: unknown }
): Promise<T> {
  const res = await fetch(window.location.origin + path, {
    headers,
    ...(init ? { method: init.method, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) } : {})
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}) as Record<string, unknown>);
    const message = (data.message as string) || (data.error as string) || `api_error:${path}:${res.status}`;
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

/** CSV-экспорт (Content-Disposition: attachment) — тело не JSON, отдаём Blob как есть. */
async function requestBlob(path: string, headers: Record<string, string>): Promise<Blob> {
  const res = await fetch(window.location.origin + path, { headers });
  if (!res.ok) throw new Error(`api_error:${path}:${res.status}`);
  return res.blob();
}

/** Загрузка аватарки (multipart/form-data) — тело нельзя JSON.stringify. */
async function requestUpload<T>(path: string, headers: Record<string, string>, form: FormData): Promise<T> {
  const res = await fetch(window.location.origin + path, { method: 'POST', headers, body: form });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}) as Record<string, unknown>);
    const message = (data.message as string) || (data.error as string) || `api_error:${path}:${res.status}`;
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export async function getOrgStores(
  headers: Record<string, string>,
  orgQuery: string
): Promise<OrgStoresResponse> {
  const qs = orgQuery ? '?' + orgQuery.replace(/^&/, '') : '';
  return request(`/org/stores${qs}`, headers);
}

export async function getMetrics(headers: Record<string, string>): Promise<MetricsResponse> {
  return request('/metrics', headers);
}

export async function getPromos(
  headers: Record<string, string>,
  orgQuery: string
): Promise<PromosListResponse> {
  const qs = orgQuery ? '?' + orgQuery.replace(/^&/, '') : '';
  return request(`/promos${qs}`, headers);
}

export async function getPromoCard(headers: Record<string, string>, id: number): Promise<PromoCard> {
  return request(`/promos/${id}`, headers);
}

export async function createPromo(
  headers: Record<string, string>,
  body: CreatePromoRequest
): Promise<CreatePromoResponse> {
  return request('/promos', headers, { method: 'POST', body });
}

export async function markPromoUsed(headers: Record<string, string>, id: number): Promise<PromoActionResponse> {
  return request(`/promos/${id}/use`, headers, { method: 'POST', body: {} });
}

export async function keepPromo(headers: Record<string, string>, id: number): Promise<PromoActionResponse> {
  return request(`/promos/${id}/keep`, headers, { method: 'POST', body: {} });
}

export async function getCashTable(
  headers: Record<string, string>,
  from: string,
  to: string,
  orgQuery: string
): Promise<CashTableResponse> {
  return request(`/cash/table?from=${from}&to=${to}${orgQuery}`, headers);
}

export async function saveCash(
  headers: Record<string, string>,
  body: SaveCashRequest
): Promise<CashRow> {
  return request('/cash', headers, { method: 'PUT', body });
}

export async function createMetric(
  headers: Record<string, string>,
  body: CreateMetricRequest
): Promise<CreateMetricResponse> {
  return request('/metrics', headers, { method: 'POST', body });
}

export async function deleteMetric(headers: Record<string, string>, id: string): Promise<DeleteMetricResponse> {
  return request(`/metrics/${id}`, headers, { method: 'DELETE' });
}

export async function sendNetworkDigest(
  headers: Record<string, string>,
  body: SendDigestRequest
): Promise<SendDigestResponse> {
  return request('/reports/send-digest', headers, { method: 'POST', body });
}

export async function getAlerts(
  headers: Record<string, string>,
  status: string,
  orgQuery: string
): Promise<AlertsListResponse> {
  return request(`/alerts?status=${status}${orgQuery}`, headers);
}

export async function changeAlertStatus(
  headers: Record<string, string>,
  id: number,
  body: ChangeAlertStatusRequest
): Promise<ChangeAlertStatusResponse> {
  return request(`/alerts/${id}/status`, headers, { method: 'POST', body });
}

export async function getAlertsEffectiveness(
  headers: Record<string, string>
): Promise<EffectivenessSummaryResponse> {
  return request('/alerts/effectiveness', headers);
}

export async function markAlertRead(
  headers: Record<string, string>,
  id: number
): Promise<MarkAlertReadResponse> {
  return request(`/alerts/${id}/read`, headers, { method: 'POST', body: {} });
}

export async function getTasks(
  headers: Record<string, string>,
  orgQuery: string
): Promise<TasksListResponse> {
  return request(`/tasks?_=1${orgQuery}`, headers);
}

export async function getTask(headers: Record<string, string>, id: number): Promise<TaskDetailResponse> {
  return request(`/tasks/${id}`, headers);
}

export async function changeTaskStatus(
  headers: Record<string, string>,
  id: number,
  body: ChangeTaskStatusRequest
): Promise<ChangeTaskStatusResponse> {
  return request(`/tasks/${id}/status`, headers, { method: 'POST', body });
}

export async function addTaskComment(
  headers: Record<string, string>,
  id: number,
  body: AddTaskCommentRequest
): Promise<AddTaskCommentResponse> {
  return request(`/tasks/${id}/comments`, headers, { method: 'POST', body });
}

export async function getCommandCenter(
  headers: Record<string, string>,
  orgQuery: string
): Promise<CommandCenterResponse> {
  return request(`/command-center?_=1${orgQuery}`, headers);
}

// queryString уже полностью собран вызывающим кодом (пусто или "?org_id=...") —
// в отличие от большинства функций выше, не принимает "&"-префиксную форму.
export async function getEmployees(
  headers: Record<string, string>,
  queryString: string
): Promise<EmployeesListResponse> {
  return request(`/employees${queryString}`, headers);
}

export async function createTask(
  headers: Record<string, string>,
  body: CreateTaskRequest
): Promise<CreateTaskResponse | { ok: true; deduped: true }> {
  return request('/tasks', headers, { method: 'POST', body });
}

// ---------- 20.7.0: оставшиеся 13 файлов эпохи 20, одним заходом ----------

export async function getMe(headers: Record<string, string>): Promise<MeResponse> {
  return request('/me', headers);
}

export async function bindMe(headers: Record<string, string>, body: BindMeRequest): Promise<BindMeResponse> {
  return request('/me/bind', headers, { method: 'POST', body });
}

export async function getMyDay(headers: Record<string, string>): Promise<MeDayResponse> {
  return request('/me/day', headers);
}

export async function getSchedules(
  headers: Record<string, string>,
  date: string,
  orgQuery: string
): Promise<SchedulesListResponse> {
  return request(`/schedules?date=${date}${orgQuery}`, headers);
}

export async function getScheduleMonth(
  headers: Record<string, string>,
  month: string,
  orgQuery: string
): Promise<ScheduleMonthResponse> {
  return request(`/schedules/month?month=${month}${orgQuery}`, headers);
}

export async function saveSchedulesBulk(
  headers: Record<string, string>,
  body: SaveScheduleBulkRequest
): Promise<SaveScheduleBulkResponse> {
  return request('/schedules/bulk', headers, { method: 'POST', body });
}

export async function getPlansTemplate(headers: Record<string, string>, date: string): Promise<PlansTemplateResponse> {
  return request(`/plans?date=${date}`, headers);
}

export async function getPlansEmployeesMonth(
  headers: Record<string, string>,
  month: string,
  orgQuery: string
): Promise<MonthSummaryTableResponse> {
  return request(`/plans/employees/month?month=${month}${orgQuery}`, headers);
}

export async function getEmployeeMonthPlan(
  headers: Record<string, string>,
  employeeId: number,
  month: string
): Promise<EmployeeMonthPlanResponse> {
  return request(`/plans/employees/${employeeId}/month?month=${month}`, headers);
}

export async function saveEmployeeMonthPlan(
  headers: Record<string, string>,
  employeeId: number,
  body: SaveMonthPlanRequest
): Promise<EmployeeMonthPlanResponse> {
  return request(`/plans/employees/${employeeId}/month`, headers, { method: 'PUT', body });
}

export async function getStoreDailyPlans(
  headers: Record<string, string>,
  orgQuery: string,
  date?: string
): Promise<StoreDailyPlansResponse> {
  const dateParam = date ? `date=${date}` : '_=1';
  return request(`/plans/stores/daily?${dateParam}${orgQuery}`, headers);
}

export async function getStoreMonthPlan(
  headers: Record<string, string>,
  storeId: string,
  month: string
): Promise<StoreMonthPlanResponse> {
  return request(`/plans/stores/${storeId}/month?month=${month}`, headers);
}

export async function saveStoreMonthPlan(
  headers: Record<string, string>,
  storeId: string,
  body: SaveMonthPlanRequest
): Promise<StoreMonthPlanResponse> {
  return request(`/plans/stores/${storeId}/month`, headers, { method: 'PUT', body });
}

export async function getBfqList(
  headers: Record<string, string>,
  month: string,
  orgQuery: string
): Promise<BfqListResponse> {
  return request(`/bfq?month=${month}${orgQuery}`, headers);
}

export async function getBfqEmployee(
  headers: Record<string, string>,
  employeeId: number,
  month: string,
  orgQuery: string
): Promise<BfqEmployeeResponse> {
  return request(`/bfq/${employeeId}?month=${month}${orgQuery}`, headers);
}

export async function saveBfqManual(headers: Record<string, string>, body: SaveBfqManualRequest): Promise<unknown> {
  return request('/bfq/manual', headers, { method: 'POST', body });
}

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

export async function getSupportAdminTickets(headers: Record<string, string>): Promise<AdminTicketsSlaResponse> {
  return request('/support/admin/tickets', headers);
}

export async function getSupervisorDashboard(
  headers: Record<string, string>,
  days: number,
  orgQuery: string
): Promise<SupervisorDashboardResponse> {
  return request(`/supervisor/dashboard?days=${days}${orgQuery}`, headers);
}

export async function getSupervisorHealth(
  headers: Record<string, string>,
  orgQuery: string
): Promise<SupervisorHealthResponse> {
  return request(`/supervisor/health?_=1${orgQuery}`, headers);
}

export async function getSales(
  headers: Record<string, string>,
  date: string,
  orgQuery: string
): Promise<SalesListResponse> {
  return request(`/sales?date=${date}${orgQuery}`, headers);
}

export async function createSale(
  headers: Record<string, string>,
  body: CreateSaleRequest
): Promise<SaleRow | { ok: true; deduped: true }> {
  return request('/sales', headers, { method: 'POST', body });
}

export async function zeroSaleMetric(
  headers: Record<string, string>,
  saleId: number | string,
  orgQuery: string,
  metric: string
): Promise<unknown> {
  const qs = orgQuery ? '?' + orgQuery.replace(/^&/, '') : '';
  return request(`/sales/${saleId}/zero${qs}`, headers, { method: 'PUT', body: { metric } });
}

export async function getSalesHistory(
  headers: Record<string, string>,
  queryString: string
): Promise<SalesHistoryResponse> {
  return request(`/sales/history${queryString}`, headers);
}

export async function openShift(headers: Record<string, string>, body: ShiftOpenRequest): Promise<ShiftOpenResponse> {
  return request('/shifts/open', headers, { method: 'POST', body });
}

export async function closeShift(headers: Record<string, string>, body: ShiftCloseRequest): Promise<ShiftCloseResponse> {
  return request('/shifts/close', headers, { method: 'POST', body });
}

export async function getShiftCurrent(headers: Record<string, string>): Promise<ShiftCurrentResponse> {
  return request('/shifts/current', headers);
}

export async function parseSalePhrase(
  headers: Record<string, string>,
  body: SalesParseRequest
): Promise<SalesParseResponse> {
  return request('/sales/parse', headers, { method: 'POST', body });
}

export async function quickSale(headers: Record<string, string>, body: SalesQuickRequest): Promise<SalesQuickResponse> {
  return request('/sales/quick', headers, { method: 'POST', body });
}

export async function getFaq(headers: Record<string, string>): Promise<FaqListResponse> {
  return request('/support/faq', headers);
}

export async function getMyTickets(headers: Record<string, string>): Promise<MyTicketsResponse> {
  return request('/support/my', headers);
}

export async function getSupportTickets(headers: Record<string, string>): Promise<AdminTicketsListResponse> {
  return request('/support/tickets', headers);
}

export async function replyTicket(
  headers: Record<string, string>,
  id: number,
  body: TicketReplyRequest
): Promise<TicketReplyResponse> {
  return request(`/support/tickets/${id}/reply`, headers, { method: 'POST', body });
}

export async function createSupportTicket(
  headers: Record<string, string>,
  body: CreateTicketRequest
): Promise<CreateTicketResponse> {
  return request('/support', headers, { method: 'POST', body });
}

export async function tutorialComplete(headers: Record<string, string>, body: TutorialCompleteRequest): Promise<unknown> {
  return request('/me/tutorial-complete', headers, { method: 'POST', body });
}

export async function getStatsDaily(
  headers: Record<string, string>,
  date: string,
  orgQuery: string
): Promise<StatsDailyResponse> {
  return request(`/stats/daily?date=${date}${orgQuery}`, headers);
}

export async function getDashboard(headers: Record<string, string>, orgQuery: string): Promise<DashboardResponse> {
  return request(`/dashboard?_=1${orgQuery}`, headers);
}

export async function getEmployeeProgress(
  headers: Record<string, string>,
  employeeId: number | string,
  date: string
): Promise<EmployeeProgressResponse> {
  return request(`/employee/progress/${employeeId}?date=${date}`, headers);
}

export async function getMyInsight(headers: Record<string, string>): Promise<MyInsightResponse> {
  return request('/me/insight', headers);
}

export async function getSelfStats(headers: Record<string, string>): Promise<SelfStatsResponse> {
  return request('/me/self-stats', headers);
}

export async function getBranding(headers: Record<string, string>): Promise<BrandingResponse> {
  return request('/branding', headers);
}

export async function getOrgsAdmin(headers: Record<string, string>): Promise<OrgsListResponse> {
  return request('/orgs', headers);
}

export async function saveOrg(
  headers: Record<string, string>,
  id: string,
  body: UpsertOrgRequest
): Promise<UpsertOrgResponse> {
  return request(`/admin/org/${encodeURIComponent(id)}`, headers, { method: 'PUT', body });
}

export async function getAuditLog(
  headers: Record<string, string>,
  orgQuery: string
): Promise<AuditListResponse> {
  return request(`/audit${orgQuery}`, headers);
}

export async function getHeatmapPrecise(
  headers: Record<string, string>,
  storeId: string,
  orgQuery: string
): Promise<HeatmapPreciseResponse> {
  return request(`/heatmap/precise/${encodeURIComponent(storeId)}?weeks=4${orgQuery}`, headers);
}

export async function getForecast(
  headers: Record<string, string>,
  storeId: string,
  orgQuery: string
): Promise<ForecastResponse> {
  return request(`/forecast/${storeId}?days=7${orgQuery}`, headers);
}

export async function getStaffingHints(
  headers: Record<string, string>,
  orgQuery: string
): Promise<StaffingHintsResponse> {
  return request(`/staffing-hints?days=7${orgQuery}`, headers);
}

export async function getAnnouncements(headers: Record<string, string>): Promise<AnnouncementsListResponse> {
  return request('/announcements', headers);
}

export async function createAnnouncement(
  headers: Record<string, string>,
  body: CreateAnnouncementRequest
): Promise<CreateAnnouncementResponse> {
  return request('/announcements', headers, { method: 'POST', body });
}

export async function markAnnouncementRead(headers: Record<string, string>, id: number): Promise<unknown> {
  return request(`/announcements/${id}/read`, headers, { method: 'POST', body: {} });
}

export async function getAnnouncementReads(
  headers: Record<string, string>,
  id: number,
  orgQuery: string
): Promise<AnnouncementReadsResponse> {
  return request(`/announcements/${id}/reads${orgQuery}`, headers);
}

export async function getReportDay(
  headers: Record<string, string>,
  storeId: string,
  date: string,
  orgQuery: string
): Promise<ReportDayResponse> {
  return request(`/reports/day/${encodeURIComponent(storeId)}?date=${encodeURIComponent(date)}${orgQuery}`, headers);
}

export async function runWhatIf(headers: Record<string, string>, body: WhatIfRequest): Promise<WhatIfResponse> {
  return request('/schedule/what-if', headers, { method: 'POST', body });
}

export async function applyWhatIf(headers: Record<string, string>, body: WhatIfRequest): Promise<WhatIfApplyResponse> {
  return request('/schedule/what-if/apply', headers, { method: 'POST', body });
}

export async function getStoreProfile(
  headers: Record<string, string>,
  storeId: string,
  orgQuery: string
): Promise<StoreProfileResponse> {
  return request(`/stores/${encodeURIComponent(storeId)}/profile?_=1${orgQuery}`, headers);
}

export async function updateStoreDisplayName(
  headers: Record<string, string>,
  storeId: string,
  displayName: string | null
): Promise<StoreRecord> {
  return request(`/stores/${encodeURIComponent(storeId)}`, headers, {
    method: 'PATCH',
    body: { display_name: displayName }
  });
}

export async function getEmployeeProfile(
  headers: Record<string, string>,
  employeeId: number | string,
  orgQuery: string
): Promise<EmployeeProfileResponse> {
  return request(`/employees/${encodeURIComponent(String(employeeId))}/profile?_=1${orgQuery}`, headers);
}

export async function createEmployee(
  headers: Record<string, string>,
  body: CreateEmployeeRequest
): Promise<CreateEmployeeResponse> {
  return request('/employees', headers, { method: 'POST', body });
}

export async function deactivateEmployee(headers: Record<string, string>, id: number): Promise<unknown> {
  return request(`/employees/${id}`, headers, { method: 'DELETE' });
}

export async function setEmployeeRole(headers: Record<string, string>, id: number, role: string): Promise<unknown> {
  return request(`/employees/${id}/role`, headers, { method: 'PATCH', body: { role } });
}

export async function createStore(
  headers: Record<string, string>,
  body: CreateStoreRequest
): Promise<StoreRecord> {
  return request('/stores', headers, { method: 'POST', body });
}

export async function getNetworkLive(
  headers: Record<string, string>,
  orgQuery: string
): Promise<NetworkLiveResponse> {
  return request(`/network/live?_=1${orgQuery}`, headers);
}

export async function uploadAvatar(headers: Record<string, string>, form: FormData): Promise<unknown> {
  return requestUpload('/me/avatar', headers, form);
}

export async function exportCsv(headers: Record<string, string>, path: string): Promise<Blob> {
  return requestBlob(path, headers);
}

declare global {
  interface Window {
    apiClient: {
      getOrgStores: typeof getOrgStores;
      getMetrics: typeof getMetrics;
      getPromos: typeof getPromos;
      getPromoCard: typeof getPromoCard;
      createPromo: typeof createPromo;
      markPromoUsed: typeof markPromoUsed;
      keepPromo: typeof keepPromo;
      getCashTable: typeof getCashTable;
      saveCash: typeof saveCash;
      createMetric: typeof createMetric;
      deleteMetric: typeof deleteMetric;
      sendNetworkDigest: typeof sendNetworkDigest;
      getAlerts: typeof getAlerts;
      changeAlertStatus: typeof changeAlertStatus;
      getAlertsEffectiveness: typeof getAlertsEffectiveness;
      markAlertRead: typeof markAlertRead;
      getTasks: typeof getTasks;
      getTask: typeof getTask;
      changeTaskStatus: typeof changeTaskStatus;
      addTaskComment: typeof addTaskComment;
      getCommandCenter: typeof getCommandCenter;
      getEmployees: typeof getEmployees;
      createTask: typeof createTask;
      getMe: typeof getMe;
      bindMe: typeof bindMe;
      getMyDay: typeof getMyDay;
      getSchedules: typeof getSchedules;
      getScheduleMonth: typeof getScheduleMonth;
      saveSchedulesBulk: typeof saveSchedulesBulk;
      getPlansTemplate: typeof getPlansTemplate;
      getPlansEmployeesMonth: typeof getPlansEmployeesMonth;
      getEmployeeMonthPlan: typeof getEmployeeMonthPlan;
      saveEmployeeMonthPlan: typeof saveEmployeeMonthPlan;
      getStoreDailyPlans: typeof getStoreDailyPlans;
      getStoreMonthPlan: typeof getStoreMonthPlan;
      saveStoreMonthPlan: typeof saveStoreMonthPlan;
      getBfqList: typeof getBfqList;
      getBfqEmployee: typeof getBfqEmployee;
      saveBfqManual: typeof saveBfqManual;
      getAccessStatus: typeof getAccessStatus;
      getAccessOrgs: typeof getAccessOrgs;
      getAccessDirectory: typeof getAccessDirectory;
      submitAccessRequest: typeof submitAccessRequest;
      getAccessRequests: typeof getAccessRequests;
      approveAccessRequest: typeof approveAccessRequest;
      rejectAccessRequest: typeof rejectAccessRequest;
      getSupportAdminTickets: typeof getSupportAdminTickets;
      getSupervisorDashboard: typeof getSupervisorDashboard;
      getSupervisorHealth: typeof getSupervisorHealth;
      getSales: typeof getSales;
      createSale: typeof createSale;
      zeroSaleMetric: typeof zeroSaleMetric;
      getSalesHistory: typeof getSalesHistory;
      openShift: typeof openShift;
      closeShift: typeof closeShift;
      getShiftCurrent: typeof getShiftCurrent;
      parseSalePhrase: typeof parseSalePhrase;
      quickSale: typeof quickSale;
      getFaq: typeof getFaq;
      getMyTickets: typeof getMyTickets;
      getSupportTickets: typeof getSupportTickets;
      replyTicket: typeof replyTicket;
      createSupportTicket: typeof createSupportTicket;
      tutorialComplete: typeof tutorialComplete;
      getStatsDaily: typeof getStatsDaily;
      getDashboard: typeof getDashboard;
      getEmployeeProgress: typeof getEmployeeProgress;
      getMyInsight: typeof getMyInsight;
      getSelfStats: typeof getSelfStats;
      getBranding: typeof getBranding;
      getOrgsAdmin: typeof getOrgsAdmin;
      saveOrg: typeof saveOrg;
      getHeatmapPrecise: typeof getHeatmapPrecise;
      getForecast: typeof getForecast;
      getStaffingHints: typeof getStaffingHints;
      getAnnouncements: typeof getAnnouncements;
      createAnnouncement: typeof createAnnouncement;
      markAnnouncementRead: typeof markAnnouncementRead;
      getAnnouncementReads: typeof getAnnouncementReads;
      getReportDay: typeof getReportDay;
      runWhatIf: typeof runWhatIf;
      applyWhatIf: typeof applyWhatIf;
      getStoreProfile: typeof getStoreProfile;
      updateStoreDisplayName: typeof updateStoreDisplayName;
      getEmployeeProfile: typeof getEmployeeProfile;
      createEmployee: typeof createEmployee;
      deactivateEmployee: typeof deactivateEmployee;
      setEmployeeRole: typeof setEmployeeRole;
      createStore: typeof createStore;
      getNetworkLive: typeof getNetworkLive;
      uploadAvatar: typeof uploadAvatar;
      exportCsv: typeof exportCsv;
      getAuditLog: typeof getAuditLog;
    };
  }
}

window.apiClient = {
  getOrgStores,
  getMetrics,
  getPromos,
  getPromoCard,
  createPromo,
  markPromoUsed,
  keepPromo,
  getCashTable,
  saveCash,
  createMetric,
  deleteMetric,
  sendNetworkDigest,
  getAlerts,
  changeAlertStatus,
  getAlertsEffectiveness,
  markAlertRead,
  getTasks,
  getTask,
  changeTaskStatus,
  addTaskComment,
  getCommandCenter,
  getEmployees,
  createTask,
  getMe,
  bindMe,
  getMyDay,
  getSchedules,
  getScheduleMonth,
  saveSchedulesBulk,
  getPlansTemplate,
  getPlansEmployeesMonth,
  getEmployeeMonthPlan,
  saveEmployeeMonthPlan,
  getStoreDailyPlans,
  getStoreMonthPlan,
  saveStoreMonthPlan,
  getBfqList,
  getBfqEmployee,
  saveBfqManual,
  getAccessStatus,
  getAccessOrgs,
  getAccessDirectory,
  submitAccessRequest,
  getAccessRequests,
  approveAccessRequest,
  rejectAccessRequest,
  getSupportAdminTickets,
  getSupervisorDashboard,
  getSupervisorHealth,
  getSales,
  createSale,
  zeroSaleMetric,
  getSalesHistory,
  openShift,
  closeShift,
  getShiftCurrent,
  parseSalePhrase,
  quickSale,
  getFaq,
  getMyTickets,
  getSupportTickets,
  replyTicket,
  createSupportTicket,
  tutorialComplete,
  getStatsDaily,
  getDashboard,
  getEmployeeProgress,
  getMyInsight,
  getSelfStats,
  getBranding,
  getOrgsAdmin,
  saveOrg,
  getHeatmapPrecise,
  getForecast,
  getStaffingHints,
  getAnnouncements,
  createAnnouncement,
  markAnnouncementRead,
  getAnnouncementReads,
  getReportDay,
  runWhatIf,
  applyWhatIf,
  getStoreProfile,
  updateStoreDisplayName,
  getEmployeeProfile,
  createEmployee,
  deactivateEmployee,
  setEmployeeRole,
  createStore,
  getNetworkLive,
  uploadAvatar,
  exportCsv,
  getAuditLog
};
