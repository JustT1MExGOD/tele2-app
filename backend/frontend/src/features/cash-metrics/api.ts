import type {
  MetricsResponse,
  CashTableResponse,
  CashRow,
  SaveCashRequest,
  CreateMetricRequest,
  CreateMetricResponse,
  DeleteMetricResponse
} from '../../../../src/shared/api-types.js';
import { request } from '../../shared/api/http-client.js';

export async function getMetrics(headers: Record<string, string>): Promise<MetricsResponse> {
  return request('/metrics', headers);
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
