import type {
  SalesListResponse,
  CreateSaleRequest,
  SaleRow,
  SalesHistoryResponse,
  SalesParseRequest,
  SalesParseResponse,
  SalesQuickRequest,
  SalesQuickResponse
} from '../../../../src/shared/api-types.js';
import { request } from '../../shared/api/http-client.js';

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

export async function parseSalePhrase(
  headers: Record<string, string>,
  body: SalesParseRequest
): Promise<SalesParseResponse> {
  return request('/sales/parse', headers, { method: 'POST', body });
}

export async function quickSale(headers: Record<string, string>, body: SalesQuickRequest): Promise<SalesQuickResponse> {
  return request('/sales/quick', headers, { method: 'POST', body });
}
