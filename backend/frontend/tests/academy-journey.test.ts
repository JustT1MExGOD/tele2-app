/**
 * T2 Academy — journey/map derivation (pure logic, no DOM).
 */
import { describe, it, expect } from 'vitest';
import { computeJourney, findNextChapter, isCourseComplete } from '../src/features/tutorial/model/journey.js';
import type { AcademyCourse } from '../src/features/tutorial/model/types.js';

function makeCourse(): AcademyCourse {
  return {
    id: 'test', role: 'employee', title: 'Test',
    chapters: [
      { id: 'c1', title: 'Chapter 1', steps: [{ id: 'c1-a', kind: 'story' }, { id: 'c1-b', kind: 'cutscene' }] },
      { id: 'c2', title: 'Chapter 2', steps: [{ id: 'c2-a', kind: 'story' }, { id: 'c2-b', kind: 'cutscene' }] },
      { id: 'c3', title: 'Chapter 3', steps: [{ id: 'c3-a', kind: 'story' }, { id: 'c3-b', kind: 'cutscene' }] }
    ]
  };
}

describe('computeJourney', () => {
  it('with no progress at all, only the first chapter is unlocked, none completed', () => {
    const nodes = computeJourney(makeCourse(), []);
    expect(nodes[0].unlocked).toBe(true);
    expect(nodes[0].completed).toBe(false);
    expect(nodes[1].unlocked).toBe(false);
    expect(nodes[2].unlocked).toBe(false);
  });

  it('completing chapter 1\'s LAST step unlocks chapter 2 but not chapter 3', () => {
    const nodes = computeJourney(makeCourse(), ['c1-a', 'c1-b']);
    expect(nodes[0].completed).toBe(true);
    expect(nodes[1].unlocked).toBe(true);
    expect(nodes[1].completed).toBe(false);
    expect(nodes[2].unlocked).toBe(false);
  });

  it('completing only the FIRST step of a chapter (not the last) does not count it as completed', () => {
    const nodes = computeJourney(makeCourse(), ['c1-a']);
    expect(nodes[0].completed).toBe(false);
    expect(nodes[1].unlocked).toBe(false);
  });

  it('stepsDone/stepsTotal reflect partial in-chapter progress for the progress affordance', () => {
    const nodes = computeJourney(makeCourse(), ['c1-a', 'c1-b', 'c2-a']);
    expect(nodes[1].stepsDone).toBe(1);
    expect(nodes[1].stepsTotal).toBe(2);
  });

  it('completing every chapter in order unlocks and completes all of them', () => {
    const nodes = computeJourney(makeCourse(), ['c1-a', 'c1-b', 'c2-a', 'c2-b', 'c3-a', 'c3-b']);
    expect(nodes.every((n) => n.completed)).toBe(true);
    expect(nodes.every((n) => n.unlocked)).toBe(true);
  });

  it('a course with zero chapters produces an empty node list without throwing', () => {
    expect(() => computeJourney({ id: 'x', role: 'employee', title: 'X', chapters: [] }, [])).not.toThrow();
    expect(computeJourney({ id: 'x', role: 'employee', title: 'X', chapters: [] }, [])).toEqual([]);
  });
});

describe('findNextChapter', () => {
  it('returns the first unlocked-but-not-completed chapter', () => {
    const nodes = computeJourney(makeCourse(), ['c1-a', 'c1-b']);
    expect(findNextChapter(nodes)?.chapter.id).toBe('c2');
  });

  it('returns null once the whole course is complete', () => {
    const nodes = computeJourney(makeCourse(), ['c1-a', 'c1-b', 'c2-a', 'c2-b', 'c3-a', 'c3-b']);
    expect(findNextChapter(nodes)).toBeNull();
  });

  it('returns the very first chapter for a brand-new learner', () => {
    const nodes = computeJourney(makeCourse(), []);
    expect(findNextChapter(nodes)?.chapter.id).toBe('c1');
  });
});

describe('isCourseComplete', () => {
  it('false until every chapter is completed', () => {
    expect(isCourseComplete(computeJourney(makeCourse(), ['c1-a', 'c1-b']))).toBe(false);
  });

  it('true once every chapter is completed', () => {
    expect(isCourseComplete(computeJourney(makeCourse(), ['c1-a', 'c1-b', 'c2-a', 'c2-b', 'c3-a', 'c3-b']))).toBe(true);
  });

  it('false for an empty chapter list (no chapters means nothing to be "complete")', () => {
    expect(isCourseComplete([])).toBe(false);
  });
});
