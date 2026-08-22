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
  telegram_id?: number | null;
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
