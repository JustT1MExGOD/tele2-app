/**
 * T2 Academy — Chapter 5 "Ещё возможности" (coverage-audit follow-up).
 * Closes the six explicit-spec topics chapters 1-4 never touched
 * (Быстрый ввод, История, Месячный план, Промокоды, Объявления,
 * офлайн-очередь). Every DISCOVER step here must have a real targetId
 * (asserted separately against index.html by academy-target-contract);
 * this test asserts the honest split itself — a STORY step must NOT
 * claim a targetId it can't actually spotlight (see chapter5.ts's doc
 * comment: the Academy overlay never switches pages mid-chapter, so a
 * step whose control lives off the home page is a STORY mention, not a
 * DISCOVER, or the spotlight would silently target a zero-size element).
 */
import { describe, it, expect } from 'vitest';
import { chapter5, EMPLOYEE_CHAPTER_5_ID } from '../src/features/tutorial/courses/employee/chapter5.js';
import { employeeCourse } from '../src/features/tutorial/courses/employee/index.js';

describe('T2 Academy — employee chapter 5', () => {
  it('is wired into the employee course between chapter 4 and the final chapter', () => {
    const ids = employeeCourse.chapters.map((c) => c.id);
    const ch4Index = ids.indexOf('employee-ch4');
    const ch5Index = ids.indexOf(EMPLOYEE_CHAPTER_5_ID);
    const finalIndex = ids.indexOf('employee-final');
    expect(ch5Index).toBe(ch4Index + 1);
    expect(finalIndex).toBe(ch5Index + 1);
  });

  it('every DISCOVER step has a real targetId; no STORY step claims one it cannot spotlight', () => {
    for (const step of chapter5.steps) {
      if (step.kind === 'discover') {
        expect(step.targetId, `discover step ${step.id} must have a targetId`).toBeTruthy();
      }
      if (step.kind === 'story') {
        expect(step.targetId, `story step ${step.id} must NOT claim a targetId it can't spotlight`).toBeFalsy();
      }
    }
  });

  it('covers the six topics the coverage audit found missing from chapters 1-4', () => {
    const allText = chapter5.steps.map((s) => `${s.say || ''} ${s.body || ''}`).join(' ');
    expect(allText).toContain('Быстрый ввод');
    expect(allText).toContain('История продаж');
    expect(allText).toMatch(/план.*месяц|месяц.*план/i);
    expect(allText).toContain('Промокоды');
    expect(allText).toContain('Объявления');
    expect(allText).toMatch(/связ|офлайн|отправ/i);
  });

  it('ends with a rewarded completion step matching the server reward table\'s step id convention', () => {
    const last = chapter5.steps[chapter5.steps.length - 1];
    expect(last.id).toBe('employee-ch5-complete');
    expect(last.kind).toBe('cutscene');
  });
});
