import type {
  AlertsListResponse,
  ChangeAlertStatusRequest,
  ChangeAlertStatusResponse,
  EffectivenessSummaryResponse,
  MarkAlertReadResponse
} from '../../../../src/shared/api-types.js';
import { request } from '../../shared/api/http-client.js';

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
