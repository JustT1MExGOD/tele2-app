/**
 * Общий контракт бэкенд↔фронтенд (20.0.0, Frontend Foundation). Пока
 * покрывает только два GET-эндпоинта, реально используемых пилотным
 * typed API-клиентом (frontend/src/api-client.ts) — остальные роуты
 * переезжают сюда по мере миграции соответствующих frontend-файлов на
 * TypeScript (см. README §22).
 */
import type { StoreRecord } from '../repositories/stores.js';

export interface OrgStoresResponse {
  org_id: string;
  stores: StoreRecord[];
}

export interface MetricDef {
  id: string;
  label: string;
  short_label: string;
  unit: string;
  unit_type: string;
}

export interface MetricsResponse {
  items: MetricDef[];
}
