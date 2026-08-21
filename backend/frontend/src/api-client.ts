/**
 * Typed API client (20.0.0+, Frontend Foundation). Собирается Vite'ом в
 * единый classic-script бандл (см. vite.config.ts — формат iife, не
 * es/umd) и подключается в index.html ДО 01-core.js как
 * /dist/api-client.bundle.js.
 *
 * Растёт по мере миграции очередного frontend-файла на TypeScript (см.
 * README §22): 20.0.0 — /org/stores, /metrics (01-core.js); 20.1.0 —
 * промокоды РТК (12-promos.js).
 *
 * Сознательно бросает на не-ok/сетевой ошибке, не глотает и не
 * подставляет фолбэк сам — это остаётся ответственностью вызывающего
 * кода (легаси-файлы уже оборачивают вызовы в try/catch с собственными
 * фолбэками, поведение снаружи не меняется).
 */
import type {
  OrgStoresResponse,
  MetricsResponse,
  PromosListResponse,
  PromoCard,
  CreatePromoRequest,
  CreatePromoResponse,
  PromoActionResponse
} from '../../src/shared/api-types.js';

/**
 * Бэкенд по всему API (глобальный setErrorHandler, 19.15.0) отвечает
 * ошибкой как {error, message?} — на не-ok разбираем тело и бросаем
 * именно этот текст, а не голый статус-код. Нужно для промокодов
 * (12-promos.js показывает серверное сообщение прямо в toast); для
 * getOrgStores/getMetrics ничего не меняет — их вызывающий код (01-core.js)
 * читает только e, не e.message, и так же молча уходит в свой фолбэк.
 */
async function request<T>(
  path: string,
  headers: Record<string, string>,
  init?: { method: string; body: unknown }
): Promise<T> {
  const res = await fetch(window.location.origin + path, {
    headers,
    ...(init ? { method: init.method, body: JSON.stringify(init.body) } : {})
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}) as Record<string, unknown>);
    const message = (data.error as string) || (data.message as string) || `api_error:${path}:${res.status}`;
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export async function getOrgStores(
  headers: Record<string, string>,
  orgQuery: string
): Promise<OrgStoresResponse> {
  const qs = orgQuery ? '?' + orgQuery.replace(/^&/, '') : '';
  return request(`/org/stores${qs}`, headers);
}

export async function getMetrics(headers: Record<string, string>): Promise<MetricsResponse> {
  return request('/metrics', headers);
}

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

declare global {
  interface Window {
    apiClient: {
      getOrgStores: typeof getOrgStores;
      getMetrics: typeof getMetrics;
      getPromos: typeof getPromos;
      getPromoCard: typeof getPromoCard;
      createPromo: typeof createPromo;
      markPromoUsed: typeof markPromoUsed;
      keepPromo: typeof keepPromo;
    };
  }
}

window.apiClient = {
  getOrgStores,
  getMetrics,
  getPromos,
  getPromoCard,
  createPromo,
  markPromoUsed,
  keepPromo
};
