import type {
  BrandingResponse,
  OrgsListResponse,
  AuditListResponse,
  DealersTreeResponse,
  UpsertOrgRequest,
  UpsertOrgResponse
} from '../../../../src/shared/api-types.js';
import { request } from '../../shared/api/http-client.js';

export async function getBranding(headers: Record<string, string>): Promise<BrandingResponse> {
  return request('/branding', headers);
}

export async function getOrgsAdmin(headers: Record<string, string>): Promise<OrgsListResponse> {
  return request('/orgs', headers);
}

export async function saveOrg(
  headers: Record<string, string>,
  id: string,
  body: UpsertOrgRequest
): Promise<UpsertOrgResponse> {
  return request(`/admin/org/${encodeURIComponent(id)}`, headers, { method: 'PUT', body });
}

export interface AuditLogFilters {
  action?: string;
  targetType?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export async function getAuditLog(
  headers: Record<string, string>,
  orgQuery: string,
  filters?: AuditLogFilters
): Promise<AuditListResponse> {
  const params = new URLSearchParams();
  if (filters?.action) params.set('action', filters.action);
  if (filters?.targetType) params.set('target_type', filters.targetType);
  if (filters?.from) params.set('from', filters.from);
  if (filters?.to) params.set('to', filters.to);
  if (filters?.limit) params.set('limit', String(filters.limit));
  if (filters?.offset) params.set('offset', String(filters.offset));
  const filterQuery = params.toString();
  // orgQuery (orgQueryParam()) всегда начинается с '&' (рассчитан на то,
  // что перед ним уже стоит '?что-то=' — как во всех остальных вызовах в
  // этом файле). Раньше здесь было `\`/audit${orgQuery}\`` без ведущего
  // '?' вообще — при непустом orgQuery это была битая ссылка
  // (`/audit&org_id=...`, без '?'), просто до сих пор никто не передавал
  // сюда orgQuery непустым (org_id-переключатель для audit не работал —
  // см. A3). Собираем корректно в обоих случаях: если есть свои фильтры,
  // orgQuery просто дописывается следом (он и так начинается с '&'); если
  // фильтров нет, а orgQuery есть — меняем его ведущий '&' на '?'.
  let qs = '';
  if (filterQuery) qs = `?${filterQuery}${orgQuery}`;
  else if (orgQuery) qs = `?${orgQuery.slice(1)}`;
  return request(`/audit${qs}`, headers);
}

export async function getDealersTree(headers: Record<string, string>): Promise<DealersTreeResponse> {
  return request('/admin/dealers', headers);
}

export async function renameDealer(headers: Record<string, string>, id: number, name: string): Promise<{ ok: true }> {
  return request(`/admin/dealers/${id}`, headers, { method: 'PATCH', body: { name } });
}

export async function renameSector(headers: Record<string, string>, id: string, name: string): Promise<{ ok: true }> {
  return request(`/admin/sectors/${encodeURIComponent(id)}`, headers, { method: 'PATCH', body: { name } });
}

export async function assignSupervisorSector(headers: Record<string, string>, supervisorId: number, sectorId: string): Promise<{ ok: true; sector_id: string }> {
  return request(`/supervisor/${supervisorId}/sector`, headers, { method: 'PUT', body: { sector_id: sectorId } });
}
