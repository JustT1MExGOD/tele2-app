import type {
  ShiftOpenRequest,
  ShiftOpenResponse,
  ShiftCloseRequest,
  ShiftCloseResponse,
  ShiftCurrentResponse,
  ShiftOpenMapResponse,
  ResolveStoreRequest,
  ResolveStoreResponse
} from '../../../../src/shared/api-types.js';
import { request } from '../../shared/api/http-client.js';

export async function openShift(headers: Record<string, string>, body: ShiftOpenRequest): Promise<ShiftOpenResponse> {
  return request('/shifts/open', headers, { method: 'POST', body });
}

/** Replacement shift — preview a manually-entered store code before opening a shift there. */
export async function resolveStore(headers: Record<string, string>, body: ResolveStoreRequest): Promise<ResolveStoreResponse> {
  return request('/shifts/resolve-store', headers, { method: 'POST', body });
}

export async function closeShift(headers: Record<string, string>, body: ShiftCloseRequest): Promise<ShiftCloseResponse> {
  return request('/shifts/close', headers, { method: 'POST', body });
}

export async function getShiftCurrent(headers: Record<string, string>): Promise<ShiftCurrentResponse> {
  return request('/shifts/current', headers);
}

/** Who's actually on a shift right now, and at which store — used to pre-fill
 * "Добавить продажу" by fact rather than by schedule. */
export async function getShiftOpenMap(headers: Record<string, string>, orgQuery: string): Promise<ShiftOpenMapResponse> {
  // orgQuery is orgQueryParam()'s own '&org_id=...' shape (or '') — there's
  // no other query param here, so it needs its leading '&' swapped for '?'.
  return request(`/shifts/open-map${orgQuery ? '?' + orgQuery.slice(1) : ''}`, headers);
}
