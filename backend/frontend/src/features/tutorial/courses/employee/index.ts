/**
 * T2 Academy — full employee course, assembled from its chapters (each
 * authored in its own file so course content stays reviewable/extensible
 * per-chapter). Manager/supervisor/admin courses are NOT authored this
 * pass (spec §15 — finish employee to production-quality depth first) —
 * model/registry.ts's getCourseForRole() returns null for those roles,
 * which is tested explicitly, not a silent gap.
 */
import type { AcademyCourse } from '../../model/types.js';
import { chapter1 } from './chapter1.js';
import { chapter2 } from './chapter2.js';
import { chapter3 } from './chapter3.js';
import { chapter4 } from './chapter4.js';
import { finalChapter } from './final.js';

export { EMPLOYEE_CHAPTER_1_ID } from './chapter1.js';
export { EMPLOYEE_CHAPTER_2_ID } from './chapter2.js';
export { EMPLOYEE_CHAPTER_3_ID } from './chapter3.js';
export { EMPLOYEE_CHAPTER_4_ID } from './chapter4.js';
export { EMPLOYEE_FINAL_CHAPTER_ID } from './final.js';

export const employeeCourse: AcademyCourse = {
  id: 'employee',
  role: 'employee',
  title: 'Сотрудник',
  chapters: [chapter1, chapter2, chapter3, chapter4, finalChapter]
};
