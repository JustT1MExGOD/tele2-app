import type {
  BfqListResponse,
  BfqEmployeeResponse,
  SaveBfqManualRequest
} from '../../../../src/shared/api-types.js';
import { request } from '../../shared/api/http-client.js';

export async function getBfqList(
  headers: Record<string, string>,
  month: string,
  orgQuery: string
): Promise<BfqListResponse> {
  return request(`/bfq?month=${month}${orgQuery}`, headers);
}

export async function getBfqEmployee(
  headers: Record<string, string>,
  employeeId: number,
  month: string,
  orgQuery: string
): Promise<BfqEmployeeResponse> {
  return request(`/bfq/${employeeId}?month=${month}${orgQuery}`, headers);
}

export async function saveBfqManual(headers: Record<string, string>, body: SaveBfqManualRequest): Promise<unknown> {
  return request('/bfq/manual', headers, { method: 'POST', body });
}
