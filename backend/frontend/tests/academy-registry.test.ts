/**
 * T2 Academy — role coverage: which role gets which course. Manager/
 * supervisor/admin are documented, not-yet-authored extension points for
 * this pass (see final report) — this test locks in that as an explicit,
 * intentional fact, not a silent gap someone finds by surprise.
 */
import { describe, it, expect } from 'vitest';
import { getCourseForRole, getAllCourses } from '../src/features/tutorial/model/registry.js';

describe('T2 Academy course registry', () => {
  it('employee gets a real course with at least one chapter', () => {
    const course = getCourseForRole('employee');
    expect(course).not.toBeNull();
    expect(course!.role).toBe('employee');
    expect(course!.chapters.length).toBeGreaterThan(0);
  });

  it('manager/supervisor/admin have no course yet in this pass — explicit, not a silent fallback', () => {
    expect(getCourseForRole('manager')).toBeNull();
    expect(getCourseForRole('supervisor')).toBeNull();
    expect(getCourseForRole('admin')).toBeNull();
  });

  it('an unknown role string never throws, just returns null', () => {
    expect(() => getCourseForRole('trainee')).not.toThrow();
    expect(getCourseForRole('trainee')).toBeNull();
    expect(getCourseForRole('not-a-real-role')).toBeNull();
  });

  it('getAllCourses() returns exactly the registered courses (employee only, for now)', () => {
    const all = getAllCourses();
    expect(all.map((c) => c.role)).toEqual(['employee']);
  });

  it('every step in every registered course has a unique id (advance/persistence assumes this)', () => {
    for (const course of getAllCourses()) {
      const ids = course.chapters.flatMap((c) => c.steps.map((s) => s.id));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
