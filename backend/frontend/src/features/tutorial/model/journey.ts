/**
 * Journey/map derivation — pure function over course data + server
 * progress, no DOM. A chapter is completed when its OWN last step id is
 * in completed_step_ids; unlocked when it's the first chapter or the
 * previous chapter is completed. Both presenters (mobile/desktop) render
 * the same ChapterNodeState[] this produces, just arranged differently.
 */
import type { AcademyChapter, AcademyCourse } from './types.js';

export interface ChapterNodeState {
  chapter: AcademyChapter;
  index: number;
  completed: boolean;
  unlocked: boolean;
  /** Steps completed / total, for a per-chapter progress affordance on the node. */
  stepsDone: number;
  stepsTotal: number;
}

export function computeJourney(course: AcademyCourse, completedStepIds: string[]): ChapterNodeState[] {
  const done = new Set(completedStepIds);
  const nodes: ChapterNodeState[] = [];
  let previousCompleted = true; // chapter 0 is always unlocked
  course.chapters.forEach((chapter, index) => {
    const lastStep = chapter.steps[chapter.steps.length - 1];
    const completed = !!lastStep && done.has(lastStep.id);
    const stepsDone = chapter.steps.filter((s) => done.has(s.id)).length;
    nodes.push({
      chapter,
      index,
      completed,
      unlocked: previousCompleted,
      stepsDone,
      stepsTotal: chapter.steps.length
    });
    previousCompleted = previousCompleted && completed;
  });
  return nodes;
}

/** The chapter a "Продолжить" action should resume into — the first
 * unlocked, not-yet-completed chapter, or null if the whole course is
 * done (or has no chapters at all). */
export function findNextChapter(nodes: ChapterNodeState[]): ChapterNodeState | null {
  return nodes.find((n) => n.unlocked && !n.completed) || null;
}

export function isCourseComplete(nodes: ChapterNodeState[]): boolean {
  return nodes.length > 0 && nodes.every((n) => n.completed);
}
