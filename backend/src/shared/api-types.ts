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

export interface CashTableEntry {
  cash_fact: number;
  cash_1c: number;
  delta: number;
  comment: string | null;
}

export interface CashTableStore {
  id: string;
  name: string;
  code: string;
}

export interface CashTableResponse {
  from: string;
  to: string;
  stores: CashTableStore[];
  dates: string[];
  cells: Record<string, Record<string, CashTableEntry>>;
}

export interface CashRow {
  id: number;
  store_id: string;
  cash_date: string;
  cash_fact: number;
  cash_1c: number;
  comment: string | null;
  created_by: number | null;
  updated_at: string;
}

export interface SaveCashRequest {
  store_id: string;
  cash_date: string;
  cash_fact: number;
  cash_1c: number;
  comment?: string;
  org_id?: string;
}

export interface CreateMetricRequest {
  label: string;
  short_label?: string;
  short?: string;
  unit?: string;
  id?: string;
}

export interface CreateMetricResponse {
  ok: true;
  item: MetricDef;
}

export interface DeleteMetricResponse {
  ok: true;
  id: string;
  active: false;
}

export interface SendDigestRequest {
  kind: 'weekly' | 'monthly';
  org_id?: string;
}

export interface SendDigestResponse {
  ok: true;
  kind: 'weekly' | 'monthly';
}
