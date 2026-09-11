/**
 * Server-backed progress — durable across devices (see final report,
 * "progress persistence"). A thin in-memory cache avoids refetching
 * completed_step_ids on every render; it's not a source of truth, just a
 * read-through cache for the current session.
 */
import { getAcademyProgress, completeAcademyStep } from '../api.js';
import type { AcademyCompleteStepResponse, AcademyProgressResponse } from '../../../../../src/shared/api-types.js';

let cache: AcademyProgressResponse | null = null;

export async function loadProgress(headers: Record<string, string>): Promise<AcademyProgressResponse> {
  cache = await getAcademyProgress(headers);
  return cache;
}

export function isStepCompleted(stepId: string): boolean {
  return !!cache?.completed_step_ids.includes(stepId);
}

export async function completeStep(headers: Record<string, string>, stepId: string): Promise<AcademyCompleteStepResponse> {
  const result = await completeAcademyStep(headers, stepId);
  if (cache && !cache.completed_step_ids.includes(stepId)) {
    cache = { ...cache, completed_step_ids: [...cache.completed_step_ids, stepId] };
    if (result.reward_granted) {
      cache = {
        ...cache,
        xp_total: cache.xp_total + result.xp_awarded,
        badges: result.badge ? [...cache.badges, { ...result.badge, earned_at: new Date().toISOString() }] : cache.badges
      };
    }
  }
  return result;
}

export function getCachedProgress(): AcademyProgressResponse | null {
  return cache;
}

/** Test-only reset — avoids cross-test leakage of the module-level cache. */
export function __resetProgressCache(): void {
  cache = null;
}
