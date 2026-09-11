/**
 * Server-authoritative reward table for T2 Academy steps — the course
 * CONTENT (narrative, ordering, UI targets) lives in frontend course data
 * (features/tutorial/courses/*), but XP/badge AMOUNTS must be decided
 * here, never trusted from the client: POST /academy/progress/complete-step
 * only grants a reward for a step_id present in this table, and only once
 * per employee (see core/academy/service.ts::completeStep, gated by
 * academy_progress's unique (employee_id, step_id) — a step not listed
 * here just gets marked completed with no reward.
 */
export interface AcademyReward {
  xp: number;
  badge?: { code: string; title: string };
}

export const ACADEMY_STEP_REWARDS: Record<string, AcademyReward> = {
  'employee-ch1-complete': {
    xp: 50,
    badge: { code: 'academy_employee_ch1', title: 'Первая замена' }
  },
  'employee-ch2-complete': {
    xp: 60,
    badge: { code: 'academy_employee_ch2', title: 'Продавец смены' }
  },
  'employee-ch3-complete': {
    xp: 60,
    badge: { code: 'academy_employee_ch3', title: 'Знаток замены' }
  },
  'employee-ch4-complete': {
    xp: 40,
    badge: { code: 'academy_employee_ch4', title: 'Исследователь' }
  },
  'employee-final-complete': {
    xp: 150,
    badge: { code: 'academy_employee_course_complete', title: 'T2 Academy: Сотрудник' }
  }
};
