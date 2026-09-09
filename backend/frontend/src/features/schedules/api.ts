import type {
  SchedulesListResponse,
  ScheduleMonthResponse,
  SaveScheduleBulkRequest,
  SaveScheduleBulkResponse,
  ScheduleAvailabilityListResponse,
  AddScheduleAvailabilityRequest,
  SchedulePreferenceRow
} from '../../../../src/shared/api-types.js';
import { request } from '../../shared/api/http-client.js';

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

export async function getScheduleAvailability(
  headers: Record<string, string>,
  employeeId: number,
  orgQuery: string
): Promise<ScheduleAvailabilityListResponse> {
  return request(`/employees/${employeeId}/schedule-availability${orgQuery}`, headers);
}

export async function addScheduleAvailability(
  headers: Record<string, string>,
  employeeId: number,
  body: AddScheduleAvailabilityRequest
): Promise<SchedulePreferenceRow> {
  return request(`/employees/${employeeId}/schedule-availability`, headers, { method: 'POST', body });
}

export async function deleteScheduleAvailability(
  headers: Record<string, string>,
  employeeId: number,
  rowId: number,
  body: { org_id?: string }
): Promise<{ ok: boolean }> {
  return request(`/employees/${employeeId}/schedule-availability/${rowId}`, headers, { method: 'DELETE', body });
}
