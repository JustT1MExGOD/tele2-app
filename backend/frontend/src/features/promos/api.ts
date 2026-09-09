import type {
  PromosListResponse,
  PromoCard,
  CreatePromoRequest,
  CreatePromoResponse,
  PromoActionResponse
} from '../../../../src/shared/api-types.js';
import { request } from '../../shared/api/http-client.js';

export async function getPromos(
  headers: Record<string, string>,
  orgQuery: string
): Promise<PromosListResponse> {
  const qs = orgQuery ? '?' + orgQuery.replace(/^&/, '') : '';
  return request(`/promos${qs}`, headers);
}

export async function getPromoCard(headers: Record<string, string>, id: number): Promise<PromoCard> {
  return request(`/promos/${id}`, headers);
}

export async function createPromo(
  headers: Record<string, string>,
  body: CreatePromoRequest
): Promise<CreatePromoResponse> {
  return request('/promos', headers, { method: 'POST', body });
}

export async function markPromoUsed(headers: Record<string, string>, id: number): Promise<PromoActionResponse> {
  return request(`/promos/${id}/use`, headers, { method: 'POST', body: {} });
}

export async function keepPromo(headers: Record<string, string>, id: number): Promise<PromoActionResponse> {
  return request(`/promos/${id}/keep`, headers, { method: 'POST', body: {} });
}
