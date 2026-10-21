import type { LeaderboardResponse } from '../../../../src/shared/api-types.js';
import { request } from '../../shared/api/http-client.js';

export async function getLeaderboard(
  headers: Record<string, string>,
  orgQuery: string,
  metric: string,
  from?: string,
  to?: string
): Promise<LeaderboardResponse> {
  const params = new URLSearchParams();
  params.set('metric', metric);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  let qs = `?${params.toString()}`;
  if (orgQuery) qs += orgQuery;
  return request(`/leaderboard${qs}`, headers);
}
