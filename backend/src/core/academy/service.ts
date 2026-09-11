/**
 * T2 Academy — server-side progress/XP/badge service. Public surface for
 * api/routes/academy.ts; never imports data/repositories/*.js belonging to
 * another module (see docs/ARCHITECTURE.md).
 */
import * as academyRepo from '../../data/repositories/academy.js';
import { ACADEMY_STEP_REWARDS } from './rewards.js';

export interface AcademyProgress {
  completed_step_ids: string[];
  xp_total: number;
  badges: { code: string; title: string; earned_at: string }[];
}

export interface CompleteStepResult {
  already_completed: boolean;
  reward_granted: boolean;
  xp_awarded: number;
  badge?: { code: string; title: string };
}

export async function getProgress(employeeId: number): Promise<AcademyProgress> {
  const [completed_step_ids, xp_total, badges] = await Promise.all([
    academyRepo.findCompletedStepIds(employeeId),
    academyRepo.getAcademyXpTotal(employeeId),
    academyRepo.findAcademyBadges(employeeId)
  ]);
  return { completed_step_ids, xp_total, badges };
}

/**
 * Idempotent: replaying the same step_id (double-tap, client retry, a
 * re-run of an already-finished course) never re-grants XP/a badge —
 * gated on academy_progress's own first-insert-wins unique index, not on
 * a second read-then-write race-prone check.
 */
export async function completeStep(employeeId: number, stepId: string): Promise<CompleteStepResult> {
  const { isNew } = await academyRepo.markStepCompleted(employeeId, stepId);
  if (!isNew) {
    return { already_completed: true, reward_granted: false, xp_awarded: 0 };
  }
  const reward = ACADEMY_STEP_REWARDS[stepId];
  if (!reward) {
    return { already_completed: false, reward_granted: false, xp_awarded: 0 };
  }
  await academyRepo.addAcademyXp(employeeId, reward.xp, stepId);
  if (reward.badge && !(await academyRepo.hasAcademyBadge(employeeId, reward.badge.code))) {
    await academyRepo.grantAcademyBadge(employeeId, reward.badge.code, reward.badge.title);
  }
  return { already_completed: false, reward_granted: true, xp_awarded: reward.xp, badge: reward.badge };
}

export async function hasDismissedContextual(employeeId: number, contextId: string): Promise<boolean> {
  return academyRepo.hasDismissedContextual(employeeId, contextId);
}

export async function dismissContextual(employeeId: number, contextId: string): Promise<void> {
  await academyRepo.dismissContextual(employeeId, contextId);
}
