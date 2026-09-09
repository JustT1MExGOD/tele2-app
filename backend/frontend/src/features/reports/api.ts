import type {
  SendDigestRequest,
  SendDigestResponse,
  StatsDailyResponse,
  DashboardResponse,
  HeatmapPreciseResponse,
  ForecastResponse,
  StaffingHintsResponse,
  AnnouncementsListResponse,
  CreateAnnouncementRequest,
  CreateAnnouncementResponse,
  AnnouncementReadsResponse,
  ReportDayResponse
} from '../../../../src/shared/api-types.js';
import { request } from '../../shared/api/http-client.js';

export async function sendNetworkDigest(
  headers: Record<string, string>,
  body: SendDigestRequest
): Promise<SendDigestResponse> {
  return request('/reports/send-digest', headers, { method: 'POST', body });
}

export async function getStatsDaily(
  headers: Record<string, string>,
  date: string,
  orgQuery: string
): Promise<StatsDailyResponse> {
  return request(`/stats/daily?date=${date}${orgQuery}`, headers);
}

export async function getDashboard(headers: Record<string, string>, orgQuery: string): Promise<DashboardResponse> {
  return request(`/dashboard?_=1${orgQuery}`, headers);
}

export async function getHeatmapPrecise(
  headers: Record<string, string>,
  storeId: string,
  orgQuery: string
): Promise<HeatmapPreciseResponse> {
  return request(`/heatmap/precise/${encodeURIComponent(storeId)}?weeks=4${orgQuery}`, headers);
}

export async function getForecast(
  headers: Record<string, string>,
  storeId: string,
  orgQuery: string
): Promise<ForecastResponse> {
  return request(`/forecast/${storeId}?days=7${orgQuery}`, headers);
}

export async function getStaffingHints(
  headers: Record<string, string>,
  orgQuery: string
): Promise<StaffingHintsResponse> {
  return request(`/staffing-hints?days=7${orgQuery}`, headers);
}

export async function getAnnouncements(headers: Record<string, string>): Promise<AnnouncementsListResponse> {
  return request('/announcements', headers);
}

export async function createAnnouncement(
  headers: Record<string, string>,
  body: CreateAnnouncementRequest
): Promise<CreateAnnouncementResponse> {
  return request('/announcements', headers, { method: 'POST', body });
}

export async function markAnnouncementRead(headers: Record<string, string>, id: number): Promise<unknown> {
  return request(`/announcements/${id}/read`, headers, { method: 'POST', body: {} });
}

export async function getAnnouncementReads(
  headers: Record<string, string>,
  id: number,
  orgQuery: string
): Promise<AnnouncementReadsResponse> {
  return request(`/announcements/${id}/reads${orgQuery}`, headers);
}

export async function getReportDay(
  headers: Record<string, string>,
  storeId: string,
  date: string,
  orgQuery: string
): Promise<ReportDayResponse> {
  return request(`/reports/day/${encodeURIComponent(storeId)}?date=${encodeURIComponent(date)}${orgQuery}`, headers);
}
