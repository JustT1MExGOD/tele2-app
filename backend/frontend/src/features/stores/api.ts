import type {
  OrgStoresResponse,
  StoreProfileResponse,
  CreateStoreRequest,
  NetworkLiveResponse
} from '../../../../src/shared/api-types.js';
import type { StoreRecord } from '../../../../src/data/repositories/stores.js';
import { request } from '../../shared/api/http-client.js';

export async function getOrgStores(
  headers: Record<string, string>,
  orgQuery: string
): Promise<OrgStoresResponse> {
  const qs = orgQuery ? '?' + orgQuery.replace(/^&/, '') : '';
  return request(`/org/stores${qs}`, headers);
}

export async function getStoreProfile(
  headers: Record<string, string>,
  storeId: string,
  orgQuery: string
): Promise<StoreProfileResponse> {
  return request(`/stores/${encodeURIComponent(storeId)}/profile?_=1${orgQuery}`, headers);
}

export async function updateStoreDisplayName(
  headers: Record<string, string>,
  storeId: string,
  displayName: string | null
): Promise<StoreRecord> {
  return request(`/stores/${encodeURIComponent(storeId)}`, headers, {
    method: 'PATCH',
    body: { display_name: displayName }
  });
}

export async function createStore(
  headers: Record<string, string>,
  body: CreateStoreRequest
): Promise<StoreRecord> {
  return request('/stores', headers, { method: 'POST', body });
}

export async function getNetworkLive(
  headers: Record<string, string>,
  orgQuery: string
): Promise<NetworkLiveResponse> {
  return request(`/network/live?_=1${orgQuery}`, headers);
}
