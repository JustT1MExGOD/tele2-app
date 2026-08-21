/**
 * Typed API client (20.0.0, Frontend Foundation) — пилотный срез: только
 * два GET-эндпоинта, уже вызываемых из frontend/js/01-core.js
 * (fetchOrgStores/loadMetricsCatalog). Собирается Vite'ом в единый
 * classic-script бандл (см. vite.config.ts — формат iife, не es/umd) и
 * подключается в index.html ДО 01-core.js как /dist/api-client.bundle.js.
 *
 * Сознательно бросает на не-ok/сетевой ошибке, не глотает и не
 * подставляет фолбэк сам — это остаётся ответственностью вызывающего
 * кода (01-core.js уже оборачивает оба вызова в try/catch с фолбэком на
 * пустой список/старый каталог, поведение снаружи не меняется).
 */
import type { OrgStoresResponse, MetricsResponse } from '../../src/shared/api-types.js';

async function request<T>(path: string, headers: Record<string, string>): Promise<T> {
  const res = await fetch(window.location.origin + path, { headers });
  if (!res.ok) throw new Error(`api_error:${path}:${res.status}`);
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

declare global {
  interface Window {
    apiClient: {
      getOrgStores: typeof getOrgStores;
      getMetrics: typeof getMetrics;
    };
  }
}

window.apiClient = { getOrgStores, getMetrics };
