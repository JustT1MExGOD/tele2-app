/**
 * Общий контракт бэкенд↔фронтенд (20.0.0, Frontend Foundation). Покрывает
 * только эндпоинты, реально используемые typed API-клиентом
 * (frontend/src/api-client.ts) — растёт по мере миграции очередного
 * frontend-файла на TypeScript (см. README §22).
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

export interface PromoListItem {
  id: number;
  mask: string;
  note: string | null;
  created_by_name: string | null;
  created_at: string;
}

export interface PromosListResponse {
  items: PromoListItem[];
}

export interface PromoCard {
  id: number;
  code: string;
  note: string | null;
  created_by_name: string | null;
  created_at: string;
}

export interface CreatePromoRequest {
  code: string;
  note?: string;
  org_id?: string;
}

export interface CreatePromoResponse {
  ok: true;
  item: { id: number; code: string; note: string | null; created_at: string };
}

export interface PromoActionResponse {
  ok: true;
  used: boolean;
}
