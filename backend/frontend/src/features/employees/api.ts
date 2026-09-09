import type {
  EmployeesListResponse,
  EmployeeProgressResponse,
  EmployeeProfileResponse,
  CreateEmployeeRequest,
  CreateEmployeeResponse
} from '../../../../src/shared/api-types.js';
import { request } from '../../shared/api/http-client.js';


// queryString уже полностью собран вызывающим кодом (пусто или "?org_id=...") —
// в отличие от большинства функций выше, не принимает "&"-префиксную форму.
export async function getEmployees(
  headers: Record<string, string>,
  queryString: string
): Promise<EmployeesListResponse> {
  return request(`/employees${queryString}`, headers);
}

export async function getEmployeeProgress(
  headers: Record<string, string>,
  employeeId: number | string,
  date: string
): Promise<EmployeeProgressResponse> {
  return request(`/employee/progress/${employeeId}?date=${date}`, headers);
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

export async function setEmployeeRole(headers: Record<string, string>, id: number, role: string, sectorId?: string): Promise<unknown> {
  const body: { role: string; sector_id?: string } = { role };
  if (sectorId) body.sector_id = sectorId;
  return request(`/employees/${id}/role`, headers, { method: 'PATCH', body });
}
