/**
 * T2 Academy — client-side progress cache (server is the source of truth;
 * see backend tests/isolation/academy.test.ts for the authoritative
 * idempotency guarantee — this only covers the read-through cache layer
 * staying consistent with what the server actually returned).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const completeAcademyStepMock = vi.fn();
const getAcademyProgressMock = vi.fn();

vi.mock('../src/features/tutorial/api.js', () => ({
  getAcademyProgress: (...args: any[]) => getAcademyProgressMock(...args),
  completeAcademyStep: (...args: any[]) => completeAcademyStepMock(...args)
}));

import { loadProgress, completeStep, isStepCompleted, getCachedProgress, __resetProgressCache } from '../src/features/tutorial/model/progress.js';

describe('T2 Academy progress cache', () => {
  beforeEach(() => {
    __resetProgressCache();
    getAcademyProgressMock.mockReset();
    completeAcademyStepMock.mockReset();
  });

  it('loadProgress() populates the cache from the server response', async () => {
    getAcademyProgressMock.mockResolvedValue({ completed_step_ids: ['s1'], xp_total: 50, badges: [] });
    const result = await loadProgress({});
    expect(result.xp_total).toBe(50);
    expect(isStepCompleted('s1')).toBe(true);
    expect(isStepCompleted('s2')).toBe(false);
  });

  it('completeStep() updates the cache with the new step id and any reward, without a second server round-trip', async () => {
    getAcademyProgressMock.mockResolvedValue({ completed_step_ids: [], xp_total: 0, badges: [] });
    await loadProgress({});
    completeAcademyStepMock.mockResolvedValue({
      already_completed: false, reward_granted: true, xp_awarded: 50,
      badge: { code: 'academy_employee_ch1', title: 'Первая замена' }
    });
    await completeStep({}, 'ch1-complete');
    expect(isStepCompleted('ch1-complete')).toBe(true);
    expect(getCachedProgress()?.xp_total).toBe(50);
    expect(getCachedProgress()?.badges).toHaveLength(1);
  });

  it('a replayed (already_completed) step does not double-add to the cached step list or XP', async () => {
    getAcademyProgressMock.mockResolvedValue({ completed_step_ids: ['ch1-complete'], xp_total: 50, badges: [{ code: 'academy_employee_ch1', title: 'Первая замена', earned_at: '2026-01-01' }] });
    await loadProgress({});
    completeAcademyStepMock.mockResolvedValue({ already_completed: true, reward_granted: false, xp_awarded: 0 });
    await completeStep({}, 'ch1-complete');
    const progress = getCachedProgress()!;
    expect(progress.completed_step_ids.filter((id) => id === 'ch1-complete')).toHaveLength(1);
    expect(progress.xp_total).toBe(50);
    expect(progress.badges).toHaveLength(1);
  });

  it('getCachedProgress() is null before loadProgress() has ever run', () => {
    expect(getCachedProgress()).toBeNull();
  });
});
