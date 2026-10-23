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

// org-switcher-aware (20.78.0 fix) — раньше org_id не передавался вообще:
// requireEmployeeInOrg на бэкенде сверял employee_id с сетью АКТОРА, и
// admin, назначая роль сотруднику переключённой сети (чужой), получал 403 —
// "Сотрудник не принадлежит вашей сети". Тот же класс бага, что уже
// чинили на «Точках» (stores.ts) и «Заявках на доступ» (access-supervisor).
export async function setEmployeeRole(
  headers: Record<string, string>,
  id: number,
  role: string,
  sectorId: string | undefined,
  orgId: string | null
): Promise<unknown> {
  const body: { role: string; sector_id?: string; org_id?: string } = { role };
  if (sectorId) body.sector_id = sectorId;
  if (orgId) body.org_id = orgId;
  return request(`/employees/${id}/role`, headers, { method: 'PATCH', body });
}
