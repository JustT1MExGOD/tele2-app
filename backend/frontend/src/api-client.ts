/**
 * Typed API client (20.0.0+, Frontend Foundation). Собирается Vite'ом в
 * единый classic-script бандл (см. vite.config.ts — формат iife, не
 * es/umd) и подключается в index.html ДО 01-core.js как
 * /dist/api-client.bundle.js.
 *
 * Растёт по мере миграции очередного frontend-файла на TypeScript (см.
 * README §22): 20.0.0 — /org/stores, /metrics (01-core.js); 20.1.0 —
 * промокоды РТК (12-promos.js); 20.2.0 — касса + кастомные метрики
 * (09-cash-metrics.js); 20.3.0 — сводка по сети (19-reports.js); 20.4.0 —
 * алерты (17-alerts.js).
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
  PromoActionResponse,
  CashTableResponse,
  CashRow,
  SaveCashRequest,
  CreateMetricRequest,
  CreateMetricResponse,
  DeleteMetricResponse,
  SendDigestRequest,
  SendDigestResponse,
  AlertsListResponse,
  ChangeAlertStatusRequest,
  ChangeAlertStatusResponse
} from '../../src/shared/api-types.js';

/**
 * Бэкенд по всему API (глобальный setErrorHandler, 19.15.0) системно
 * кладёт машинный код в error и человекочитаемый текст в message
 * ({error:'locked', message:'Базовую метрику нельзя удалить'}) — на
 * не-ok разбираем тело и бросаем message первым (не error), иначе toast
 * показал бы код вместо текста (09-cash-metrics.js::saveMetric/
 * deleteMetric уже так делали до миграции — j.message || j.error).
 */
async function request<T>(
  path: string,
  headers: Record<string, string>,
  init?: { method: string; body?: unknown }
): Promise<T> {
  const res = await fetch(window.location.origin + path, {
    headers,
    ...(init ? { method: init.method, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) } : {})
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}) as Record<string, unknown>);
    const message = (data.message as string) || (data.error as string) || `api_error:${path}:${res.status}`;
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

export async function sendNetworkDigest(
  headers: Record<string, string>,
  body: SendDigestRequest
): Promise<SendDigestResponse> {
  return request('/reports/send-digest', headers, { method: 'POST', body });
}

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
      getCashTable: typeof getCashTable;
      saveCash: typeof saveCash;
      createMetric: typeof createMetric;
      deleteMetric: typeof deleteMetric;
      sendNetworkDigest: typeof sendNetworkDigest;
      getAlerts: typeof getAlerts;
      changeAlertStatus: typeof changeAlertStatus;
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
  keepPromo,
  getCashTable,
  saveCash,
  createMetric,
  deleteMetric,
  sendNetworkDigest,
  getAlerts,
  changeAlertStatus
};
