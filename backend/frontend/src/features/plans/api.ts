import type {
  PlansTemplateResponse,
  MonthSummaryTableResponse,
  StoreMonthSummaryTableResponse,
  EmployeeMonthPlanResponse,
  SaveMonthPlanRequest,
  StoreDailyPlansResponse,
  StoreMonthPlanResponse
} from '../../../../src/shared/api-types.js';
import { request } from '../../shared/api/http-client.js';

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

export async function getPlansStoresMonth(
  headers: Record<string, string>,
  month: string,
  orgQuery: string
): Promise<StoreMonthSummaryTableResponse> {
  return request(`/plans/stores/month?month=${month}${orgQuery}`, headers);
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
