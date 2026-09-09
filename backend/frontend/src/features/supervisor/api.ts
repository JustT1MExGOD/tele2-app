import type {
  SupervisorDashboardResponse,
  SupervisorHealthResponse
} from '../../../../src/shared/api-types.js';
import { request } from '../../shared/api/http-client.js';

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
