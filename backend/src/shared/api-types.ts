/**
 * Общий контракт бэкенд↔фронтенд (20.0.0, Frontend Foundation). Покрывает
 * только эндпоинты, реально используемые typed API-клиентом
 * (frontend/src/api-client.ts) — растёт по мере миграции очередного
 * frontend-файла на TypeScript (см. README §22).
 */
import type { StoreRecord } from '../repositories/stores.js';

export interface OrgStoresResponse {
  org_id: string;
  stores: StoreRecord[];
}

export interface MetricDef {
  id: string;
  label: string;
  short_label: string;
  unit: string;
  unit_type: string;
}

export interface MetricsResponse {
  items: MetricDef[];
}

export interface PromoListItem {
  id: number;
  mask: string;
  note: string | null;
  created_by_name: string | null;
  created_at: string;
}

export interface PromosListResponse {
  items: PromoListItem[];
}

export interface PromoCard {
  id: number;
  code: string;
  note: string | null;
  created_by_name: string | null;
  created_at: string;
}

export interface CreatePromoRequest {
  code: string;
  note?: string;
  org_id?: string;
}

export interface CreatePromoResponse {
  ok: true;
  item: { id: number; code: string; note: string | null; created_at: string };
}

export interface PromoActionResponse {
  ok: true;
  used: boolean;
}

export interface CashTableEntry {
  cash_fact: number;
  cash_1c: number;
  delta: number;
  comment: string | null;
}

export interface CashTableStore {
  id: string;
  name: string;
  code: string;
}

export interface CashTableResponse {
  from: string;
  to: string;
  stores: CashTableStore[];
  dates: string[];
  cells: Record<string, Record<string, CashTableEntry>>;
}

export interface CashRow {
  id: number;
  store_id: string;
  cash_date: string;
  cash_fact: number;
  cash_1c: number;
  comment: string | null;
  created_by: number | null;
  updated_at: string;
}

export interface SaveCashRequest {
  store_id: string;
  cash_date: string;
  cash_fact: number;
  cash_1c: number;
  comment?: string;
  org_id?: string;
}

export interface CreateMetricRequest {
  label: string;
  short_label?: string;
  short?: string;
  unit?: string;
  id?: string;
}

export interface CreateMetricResponse {
  ok: true;
  item: MetricDef;
}

export interface DeleteMetricResponse {
  ok: true;
  id: string;
  active: false;
}

export interface SendDigestRequest {
  kind: 'weekly' | 'monthly';
  org_id?: string;
}

export interface SendDigestResponse {
  ok: true;
  kind: 'weekly' | 'monthly';
}

export interface AlertItem {
  id: number;
  store_id: string | null;
  employee_id: number | null;
  alert_type: string;
  severity: string;
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
  status: string;
  created_at: string;
  acked_at: string | null;
  acked_by: number | null;
  alert_date: string;
  updated_at: string | null;
  store_name: string | null;
  task_id: number | null;
  task_status: string | null;
}

export type AlertsListResponse = AlertItem[];

export interface ChangeAlertStatusRequest {
  status: string;
  org_id?: string;
}

export type ChangeAlertStatusResponse = AlertItem;

export interface TaskItem {
  id: number;
  org_id: string;
  title: string;
  description: string | null;
  created_by: number;
  assigned_to: number;
  store_id: string | null;
  alert_id: number | null;
  priority: string;
  status: string;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  // Присутствуют только в списке (GET /tasks — LEFT JOIN); карточка задачи
  // (GET /tasks/:id, getTaskOr404 — голый SELECT * без джойна) и ответ
  // смены статуса (UPDATE ... RETURNING *) их не несут.
  assignee_name?: string | null;
  store_name?: string | null;
}

export type TasksListResponse = TaskItem[];

export interface TaskComment {
  id: number;
  task_id: number;
  author_id: number;
  body: string;
  created_at: string;
  // Есть только в GET /tasks/:id (JOIN на employees); прямой INSERT ...
  // RETURNING * из POST /tasks/:id/comments его не несёт.
  author_name?: string | null;
}

export interface TaskDetailResponse {
  task: TaskItem;
  comments: TaskComment[];
}

export interface ChangeTaskStatusRequest {
  status: string;
  comment?: string;
}

export type ChangeTaskStatusResponse = TaskItem;

export interface AddTaskCommentRequest {
  body: string;
}

export type AddTaskCommentResponse = TaskComment;

export interface EmployeeListItem {
  id: number;
  full_name: string;
  short_name: string | null;
  // Только manager-tier (manager/senior/admin) — обычный сотрудник его не видит.
  telegram_id?: number | string | null;
  is_active: boolean;
  role: string;
}

export type EmployeesListResponse = EmployeeListItem[];

export interface CreateTaskRequest {
  title: string;
  assigned_to: number;
  description?: string;
  store_id?: string | null;
  alert_id?: number | null;
  priority?: string;
  due_at?: string | null;
  org_id?: string;
}

export type CreateTaskResponse = TaskItem;

/**
 * GET /command-center — ответ собирается из buildSupervisorDashboard()
 * (services/supervisor-analytics.ts), у которой нет собственного типа
 * возврата (большая инференсная функция, общая для нескольких роутов).
 * Ниже — не полный внутренний контракт того дашборда, а только поля,
 * которые реально читает 14-command-center.js. Аннотация на самом
 * роуте (routes-command-center.ts) поэтому декларативная, не
 * компилируемая гарантия — dash.network/dash.stores остаются `any`
 * изнутри, TS не проверяет их форму на месте присвоения.
 */
export interface CommandCenterNetwork {
  health: number;
  overall_pct: number;
  pace_delta: number;
  staff_on_shift: number;
  stores_count: number;
}

export interface CommandCenterStoreToday {
  overall?: number;
  sim?: number;
  plan_sim?: number;
  mnp?: number;
  plan_mnp?: number;
}

export interface CommandCenterStoreSummary {
  name: string;
  color?: string | null;
  staff_count?: number;
  today?: CommandCenterStoreToday;
}

export interface CommandCenterAction {
  type: 'open_employee' | 'open_store' | 'create_task';
  id?: number | string;
  store_id?: string | null;
  employee_id?: number | null;
  alert_id?: number | null;
  message?: string;
}

export interface CommandCenterProblem {
  severity: string;
  message: string;
  store_id?: string | null;
  store_name?: string | null;
  ai_comment?: string | null;
  alert_id?: number;
  actions: CommandCenterAction[];
}

export interface CommandCenterResponse {
  date: string;
  network: CommandCenterNetwork;
  stores: CommandCenterStoreSummary[];
  problems: CommandCenterProblem[];
  underperforming_count: number;
  alerts_count: number;
  generated_at: string;
}

/**
 * 20.7.0 — оставшиеся 13 frontend-файлов эпохи 20, одним заходом. Многие
 * GET-ответы ниже собираются большими нетипизированными функциями
 * (buildSupervisorDashboard, getMonthSummaryTable, calculateAllBFQ,
 * simulateScheduleMoves и т.п.) без собственного возвращаемого типа —
 * контракт описывает только то, что реально читает соответствующий
 * frontend-файл (тот же приём, что CommandCenterResponse в 20.6.0), не
 * полную внутреннюю форму. Там, где это честная сериализация SQL-строк
 * известной таблицы (ScheduleRow, SaleRow и т.п.) — типы полные.
 */

// ---------- /me, /me/day, /me/bind ----------
export interface MeResponse {
  bound: boolean;
  employee_id: number | null;
  id?: number;
  full_name: string | null;
  role: string | null;
  telegram_id?: number | string | string[] | null;
  is_manager?: boolean;
  org_id?: string;
}

export interface BindMeRequest {
  telegram_id: number;
  employee_id: number;
}

export type BindMeResponse = MeResponse & { bound: true };

export interface MeDayResponse {
  bound: boolean;
  message?: string;
  employee?: { id: number; full_name: string; short_name: string | null; role: string; telegram_id: number | string | null };
  date?: string;
  shift?: {
    store_id: string; store_name: string | null; store_code: string | null; store_address: string | null;
    color: string | null; shift_text: string | null; hours: number | null;
  } | null;
  fact?: Record<string, number>;
  daily_plan?: Record<string, number>;
  progress?: Record<string, { fact: number; plan: number; pct: number }>;
  total?: { fact: number; plan: number; pct: number };
  month_plan?: Record<string, unknown> | null;
  month_fact?: Record<string, number>;
  remaining_shifts?: number;
  tasks?: TaskItem[];
}

// ---------- /schedules, /schedules/month, /schedules/bulk ----------
export interface ScheduleRow {
  work_date: string;
  shift_text: string | null;
  hours: number | null;
  store_id: string;
  employee_id: number;
  full_name: string;
  short_name?: string | null;
  store_name: string | null;
  store_short?: string | null;
}

export type SchedulesListResponse = ScheduleRow[];

export interface ScheduleMonthResponse {
  month: string;
  start: string;
  end: string;
  items: ScheduleRow[];
}

export interface ScheduleBulkItemInput {
  employee_id: number;
  store_id: string;
  work_date: string;
  hours: number;
  shift_text?: string;
}

export interface SaveScheduleBulkRequest {
  items: ScheduleBulkItemInput[];
  org_id?: string;
}

export interface SaveScheduleBulkResponse {
  ok: true;
  count: number;
  items: Array<ScheduleRow | { employee_id: number; work_date: string; deleted: true }>;
}

// ---------- /plans, /plans/employees/month(+:id), /plans/stores/daily(+:id/month) ----------
/** Динамический набор метрик (каталог plan_metrics) — не перечисляем поимённо. */
export type MetricValues = Record<string, number>;

export type SaveMonthPlanRequest = MetricValues & {
  month?: string;
  org_id?: string;
};

export interface MonthSummaryRow {
  employee_id: number;
  full_name: string;
  role?: string;
  shifts?: number;
  remaining_shifts?: number;
  plan: MetricValues;
  fact: MetricValues;
  pct: MetricValues;
}

export interface MonthSummaryTableResponse {
  rows: MonthSummaryRow[];
  remaining_days?: number;
  totals?: { fact?: MetricValues; plan?: MetricValues; pct?: MetricValues };
}

export type EmployeeMonthPlanResponse = MetricValues & {
  employee_id?: number;
  month?: string;
  empty?: boolean;
};

export interface StoreDailyPlanEntry {
  store_id: string;
  name: string;
  code?: string | null;
  has_plan?: boolean;
  plan: MetricValues;
}

export interface StoreDailyPlansResponse {
  stores: StoreDailyPlanEntry[];
}

export type StoreMonthPlanResponse = MetricValues & {
  store_id?: string;
  month?: string;
  empty?: boolean;
};

export type PlansTemplateResponse = Array<{ store_id: string; plan_date: string | null } & MetricValues>;

// ---------- /bfq, /bfq/:id, /bfq/manual ----------
export interface BfqListItem {
  employee_id: number;
  full_name: string;
  total?: number;
  forecast?: number;
  quality?: number;
  profit?: number;
  vmr?: number;
  penalty?: number;
  pct?: MetricValues;
  shifts?: { worked: number; remaining: number };
}

export interface BfqListResponse {
  month: string;
  items: BfqListItem[];
}

export interface BfqEmployeeResponse {
  fact?: Record<string, unknown>;
  forecast?: Record<string, unknown>;
  shifts?: { worked: number; remaining: number };
  [key: string]: unknown;
}

export interface SaveBfqManualRequest {
  employee_id: number;
  month?: string;
  vmr_avg?: number;
  penalty?: number;
  org_id?: string;
}

// ---------- /access/* ----------
export interface AccessStatusResponse {
  status: string;
  user?: unknown;
  request?: unknown;
}

export interface AccessOrgPublic {
  id: string;
  name: string;
  brand_name?: string | null;
}

export type AccessOrgsResponse = AccessOrgPublic[];

export interface AccessDirectoryItem {
  id: number;
  full_name: string;
}

export type AccessDirectoryResponse = AccessDirectoryItem[];

export interface SubmitAccessRequestRequest {
  full_name: string;
  claimed_employee_id?: number | null;
  org_id?: string | null;
  username?: string | null;
  message?: string;
}

export interface SubmitAccessRequestResponse {
  ok: true;
  status: string;
  id?: number;
  message?: string;
  request?: unknown;
}

export interface AccessRequestItem {
  id: number;
  telegram_id: number | string;
  full_name: string;
  message: string | null;
  status: string;
  created_at: string;
}

export type AccessRequestsListResponse = AccessRequestItem[];

export interface ApproveAccessRequest {
  role?: string;
  org_id?: string;
}

export interface ApproveAccessResponse {
  ok: true;
  employee_id: number | null;
  role: string;
}

export interface RejectAccessRequest {
  org_id?: string;
}

// ---------- /supervisor/health, /supervisor/dashboard ----------
export interface SupervisorHealthResponse {
  health: number;
  overall_pct: number;
  pace_delta: number;
  drops: unknown[];
  date: string;
}

/** buildSupervisorDashboard() полностью — сектор/сеть в целом, не типизируем
 * каждое вложенное поле (network.month.metrics/forecast на 15 динамических
 * метрик, per-store today/month/staff/alerts) — см. комментарий выше файла. */
export interface SupervisorDashboardResponse {
  date?: string;
  from?: string;
  network?: Record<string, unknown>;
  stores?: Array<Record<string, unknown>>;
  drops?: unknown[];
  trend?: unknown[];
  top_employees?: unknown[];
  [key: string]: unknown;
}

// ---------- /sales, /sales/history ----------
export type SaleRow = MetricValues & {
  id: number;
  employee_id: number;
  store_id: string;
  sale_date: string;
  full_name: string;
  store_name: string | null;
};

export type SalesListResponse = SaleRow[];

export type CreateSaleRequest = MetricValues & {
  employee_id: number;
  store_id: string;
  sale_date?: string;
  client_id?: string;
  org_id?: string;
};

export interface SalesHistoryResponse {
  from: string;
  to: string;
  count: number;
  items: SaleRow[];
}

// ---------- /shifts/*, /sales/parse, /sales/quick ----------
export interface GeoCoords {
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
}

export type ShiftOpenRequest = GeoCoords & { work_date?: string; store_id?: string };

export interface ShiftOpenResponse {
  ok: true;
  session: Record<string, unknown>;
  deduped: boolean;
  day_plan: MetricValues;
  handover: { handover_note: string; closed_at: string; from_employee_name: string } | null;
  open_tasks: TaskItem[];
}

export interface ShiftCloseRequest extends GeoCoords {
  self_report?: string;
  mood?: number;
  blockers?: string;
  handover_note?: string;
}

export interface ShiftCloseResponse {
  ok: true;
  session: Record<string, unknown>;
  plan_pct?: number;
  ideal_shift?: boolean;
  ideal_missing?: string[];
  score?: number;
  fact?: MetricValues;
  day_plan?: MetricValues;
  gamification?: Record<string, unknown>;
  rewarded?: boolean;
  ai_summary?: string | null;
  deduped?: boolean;
}

export interface ShiftCurrentResponse {
  session: Record<string, unknown> | null;
  fact?: MetricValues;
  day_plan?: MetricValues;
  plan_pct?: number;
}

export interface SalesParseRequest {
  text: string;
}

export interface SalesParseResponse {
  metrics: MetricValues;
  confidence?: number;
  [key: string]: unknown;
}

export interface SalesQuickRequest {
  text: string;
  employee_id?: number;
  store_id?: string;
  sale_date?: string;
  org_id?: string;
  client_id?: string;
}

export interface SalesQuickResponse {
  ok: true;
  deduped?: boolean;
  parsed: SalesParseResponse;
  sale: SaleRow | null;
}

// ---------- /support/*, /me/tutorial-complete ----------
export interface FaqItem {
  id: number;
  question: string;
  answer: string;
}

export type FaqListResponse = FaqItem[];

export interface SupportTicket {
  id: number;
  telegram_id: number | null;
  employee_id: number | null;
  full_name: string | null;
  category: string | null;
  message: string;
  status: string;
  admin_reply: string | null;
  created_at: string;
  sla_status?: string;
  sla_due_at?: string | null;
}

export type MyTicketsResponse = SupportTicket[];
export type AdminTicketsListResponse = SupportTicket[];

export interface AdminTicketsSlaResponse {
  items: SupportTicket[];
}

export interface CreateTicketRequest {
  message: string;
  full_name?: string;
  category?: string;
  priority?: string;
}

export interface CreateTicketResponse {
  ticket: SupportTicket;
  auto_reply: string | null;
  message: string;
}

export interface TicketReplyRequest {
  reply: string;
}

export type TicketReplyResponse = SupportTicket;

export interface TutorialCompleteRequest {
  mode?: string;
}

// ---------- /stats/daily, /dashboard, /employee/progress/:id ----------
export type StatsDailyRow = MetricValues & {
  store_id: string;
  name: string;
  code: string | null;
};

export type StatsDailyResponse = StatsDailyRow[];

export interface DashboardLeaderRow {
  employee_id: number;
  full_name: string;
  sim: number;
  mnp: number;
  pa: number;
  combo: number;
  phones: number;
  accessories: number;
  score: number;
}

export interface DashboardResponse {
  top: DashboardLeaderRow[];
  top7: DashboardLeaderRow[];
  period: { from: string | null; to: string };
}

export interface EmployeeProgressResponse {
  total: { fact: number; plan: number; percent: number };
  [metric: string]: { fact: number; plan: number } | { fact: number; plan: number; percent: number };
}

// ---------- /me/insight, /me/self-stats ----------
export interface MyInsightResponse {
  store_id?: string;
  message?: string;
  fact?: MetricValues;
  day_plan?: MetricValues;
  insight?: { message: string; focus?: string[]; split?: Record<string, unknown> } | null;
}

export interface SelfStatsResponse {
  gamification?: Record<string, unknown>;
  best_shift?: { date: string; score: number } | null;
  [key: string]: unknown;
}

// ---------- /branding, /orgs, /admin/org/:id ----------
export interface BrandingResponse {
  org_id: string;
  name: string;
  brand_name: string;
  primary_color: string;
  logo_url: string | null;
  app_title: string;
}

export interface OrgAdminItem {
  id: string;
  name: string;
  brand_name?: string | null;
  primary_color?: string | null;
  sector_id?: string | null;
  chat_id?: string | null;
  sales_thread_id?: string | null;
  reports_thread_id?: string | null;
  is_active?: boolean;
}

export type OrgsListResponse = OrgAdminItem[];

export interface UpsertOrgRequest {
  name: string;
  brand_name?: string;
  primary_color?: string;
  sector_id?: string;
  chat_id?: string;
  sales_thread_id?: string;
  reports_thread_id?: string;
  is_active?: boolean;
}

export type UpsertOrgResponse = OrgAdminItem;

// ---------- /heatmap/precise/:id, /forecast/:id, /staffing-hints ----------
export interface HeatmapPreciseResponse {
  note?: string;
  hours?: Array<{ hour: number; intensity: number; sim: number; mnp: number; pa: number; combo: number; total: number }>;
  profile?: Record<string, number>;
  rows?: unknown[];
  [key: string]: unknown;
}

export interface ForecastResponse {
  store_id: string;
  history_days: number;
  items: Array<{ date: string; predicted: MetricValues }>;
  ai_summary?: string | null;
}

export interface StaffingHint {
  severity: string;
  store_id: string;
  store_name: string;
  date: string;
  message: string;
}

export interface StaffingHintsResponse {
  items: StaffingHint[];
}

// ---------- /announcements/* ----------
export interface AnnouncementItem {
  id: number;
  title: string;
  body: string;
  required: boolean;
  is_read: boolean;
  created_at: string;
}

export type AnnouncementsListResponse = AnnouncementItem[];

export interface CreateAnnouncementRequest {
  title: string;
  body: string;
  required?: boolean;
  org_id?: string;
}

export type CreateAnnouncementResponse = AnnouncementItem;

export interface AnnouncementReadsResponse {
  read: Array<{ id: number; full_name: string; read_at: string }>;
  unread: Array<{ id: number; full_name: string }>;
}

// ---------- /reports/day/:id ----------
export interface ReportDayResponse {
  ok: true;
  store_id: string;
  date: string;
  kind: 'micro' | 'final' | 'story';
  content_type: string;
  svg?: string;
  svgs?: { plan: string; fact: string; tomorrow: string };
}

// ---------- /schedule/what-if(/apply) ----------
export interface WhatIfMoveInput {
  employee_id: number;
  from_store?: string | null;
  to_store: string;
  work_date?: string;
}

export interface WhatIfRequest {
  date?: string;
  moves?: WhatIfMoveInput[];
  employee_id?: number;
  from_store?: string | null;
  to_store?: string;
  org_id?: string;
}

/** simulateScheduleMoves() — та же логика неполной типизации, что у
 * SupervisorDashboardResponse: только поля, которые реально читает
 * 13-v14.js (renderWiScenario/compareWiScenarios). */
export interface WhatIfResponse {
  date?: string;
  stores?: Array<Record<string, unknown>>;
  summary?: { stores_gained?: string[]; stores_lost?: string[] };
  moves_applied?: Array<{ employee_id: number; to_store?: string; to?: string; skipped?: boolean }>;
  [key: string]: unknown;
}

export interface WhatIfApplyResponse {
  ok: true;
  count: number;
  [key: string]: unknown;
}

// ---------- /stores/:id/profile, /employees/:id/profile ----------
export interface StoreProfileResponse {
  store: {
    store_id: string; name: string; code: string; color: string | null;
    staff_count: number; staff: Array<{ name?: string; full_name?: string }>;
  };
  today?: { metrics?: Record<string, { fact: number; plan: number }> };
  month?: Record<string, unknown>;
  trend: Array<{ date: string; units: number }>;
  alerts: string[];
  tasks: TaskItem[];
  health: { score: number; components: Record<string, { value: number; weight: number }> };
  period: { from: string; to: string; days: number };
  generated_at: string;
}

export interface EmployeeProfileResponse {
  employee: { id: number; full_name: string; short_name: string | null; role: string };
  bfq: Record<string, unknown>;
  gamification: Record<string, unknown>;
  shifts: { recent: unknown[]; ideal_rate: number };
  health: { score: number; components: Record<string, { value: number; weight: number }> };
  period: { from: string; to: string; days: number };
  generated_at: string;
}

// ---------- /employees CRUD (POST/PATCH), /stores POST ----------
export interface CreateEmployeeRequest {
  full_name: string;
  short_name?: string;
  role?: string;
  org_id?: string;
}

export type CreateEmployeeResponse = EmployeeListItem;

export interface UpdateEmployeeRequest {
  full_name?: string;
  short_name?: string;
  is_active?: boolean;
  org_id?: string;
}

// ---------- /network/live ----------
export interface NetworkLiveStore {
  store_id: string;
  name: string;
  color?: string | null;
  status?: string;
  plan_pct?: number;
  staff?: Array<{ short_name?: string; full_name?: string; employee_id?: number }>;
  fact?: MetricValues;
  plan?: MetricValues;
  cash?: { delta: number } | null;
}

export interface NetworkLiveResponse {
  date?: string;
  stores?: NetworkLiveStore[];
  [key: string]: unknown;
}

// ---------- /audit ----------
export interface AuditLogItem {
  id: number;
  org_id: string | null;
  actor_employee_id: number | null;
  actor_telegram_id: number | null;
  actor_name: string | null;
  /** Роль актора на момент действия (снимок, не текущая роль) — 20.10.0. */
  actor_role: string | null;
  /** Сеть цели действия — 20.10.0, сегодня всегда совпадает с org_id. */
  target_org_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  before: unknown;
  after: unknown;
  request_id: string | null;
  created_at: string;
}

export interface AuditListResponse {
  items: AuditLogItem[];
}

export interface CreateStoreRequest {
  id: string;
  name: string;
  code?: string;
  color?: string;
  work_time?: string;
  hours?: number;
  close_time_weekday?: string;
  close_time_sunday?: string;
  org_id?: string;
}
