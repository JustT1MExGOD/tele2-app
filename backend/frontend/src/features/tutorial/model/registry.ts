import type { AcademyCourse } from './types.js';
import { employeeCourse } from '../courses/employee/index.js';

/** Manager/supervisor/admin courses are registry-ready extension points —
 * not authored in this pass (see final report). Adding one is: author a
 * courses/<role>/*.ts file with the same AcademyCourse shape, register it
 * here. */
const COURSES: Partial<Record<AcademyCourse['role'], AcademyCourse>> = {
  employee: employeeCourse
};

export function getCourseForRole(role: string): AcademyCourse | null {
  return COURSES[role as AcademyCourse['role']] || null;
}

export function getAllCourses(): AcademyCourse[] {
  return Object.values(COURSES) as AcademyCourse[];
}
