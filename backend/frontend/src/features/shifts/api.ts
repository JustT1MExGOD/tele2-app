import type {
  ShiftOpenRequest,
  ShiftOpenResponse,
  ShiftCloseRequest,
  ShiftCloseResponse,
  ShiftCurrentResponse
} from '../../../../src/shared/api-types.js';
import { request } from '../../shared/api/http-client.js';

export async function openShift(headers: Record<string, string>, body: ShiftOpenRequest): Promise<ShiftOpenResponse> {
  return request('/shifts/open', headers, { method: 'POST', body });
}

export async function closeShift(headers: Record<string, string>, body: ShiftCloseRequest): Promise<ShiftCloseResponse> {
  return request('/shifts/close', headers, { method: 'POST', body });
}

export async function getShiftCurrent(headers: Record<string, string>): Promise<ShiftCurrentResponse> {
  return request('/shifts/current', headers);
}
