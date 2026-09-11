/**
 * Pure step-runner state machine — no DOM access, no network calls. UI
 * presenters (ui/mobile, ui/desktop) render whatever state this exposes
 * and call back into it (advance/markRequiredActionDone/answerQuiz);
 * network completion (POST /academy/progress/complete-step) is triggered
 * by the caller of advance() when a step actually completes, not by the
 * engine itself — keeps this file trivially unit-testable.
 */
import type { AcademyChapter, AcademyCourse, AcademyStep } from '../model/types.js';

export type EngineListener = () => void;

export class TutorialEngine {
  private course: AcademyCourse;
  private chapterIndex = 0;
  private stepIndex = 0;
  private requiredActionDone = false;
  private quizAnswered = false;
  private quizCorrect = false;
  private listeners = new Set<EngineListener>();

  constructor(course: AcademyCourse) {
    this.course = course;
  }

  subscribe(fn: EngineListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  getChapter(): AcademyChapter {
    return this.course.chapters[this.chapterIndex];
  }

  getStep(): AcademyStep {
    return this.getChapter().steps[this.stepIndex];
  }

  getStepProgress(): { index: number; total: number } {
    return { index: this.stepIndex, total: this.getChapter().steps.length };
  }

  /** DISCOVER/PRACTICE/CHALLENGE steps require an explicit external signal
   * (the user actually interacted with the real target, or completed the
   * sandboxed practice) before advance() is allowed to move on. */
  canAdvance(): boolean {
    const step = this.getStep();
    switch (step.kind) {
      case 'story':
      case 'cutscene':
        return true;
      case 'discover':
      case 'practice':
      case 'challenge':
        return this.requiredActionDone;
      case 'quiz':
        return this.quizAnswered && this.quizCorrect;
      default:
        return true;
    }
  }

  markRequiredActionDone(): void {
    this.requiredActionDone = true;
    this.emit();
  }

  /** Returns whether the answer was correct — quiz UI uses this to decide
   * whether to show a "try again" reaction without allowing advance(). */
  answerQuiz(optionIndex: number): boolean {
    const quiz = this.getStep().quiz;
    if (!quiz) return false;
    this.quizAnswered = true;
    this.quizCorrect = optionIndex === quiz.correctIndex;
    this.emit();
    return this.quizCorrect;
  }

  /** True when advancing from the current step finishes the whole
   * chapter (last step of the last... well, last step of this chapter —
   * chapter completion, not course completion). */
  isLastStepOfChapter(): boolean {
    return this.stepIndex === this.getChapter().steps.length - 1;
  }

  /** Advances to the next step (or reports chapter completion on the last
   * step) — throws if canAdvance() is false, so a UI bug that lets a user
   * bypass a mandatory practice step fails loudly instead of silently
   * skipping it. */
  advance(): { done: boolean; chapterComplete: boolean } {
    if (!this.canAdvance()) {
      throw new Error(`Cannot advance past required step: ${this.getStep().id}`);
    }
    const chapterComplete = this.isLastStepOfChapter();
    if (chapterComplete) {
      this.emit();
      return { done: true, chapterComplete: true };
    }
    this.stepIndex += 1;
    this.requiredActionDone = false;
    this.quizAnswered = false;
    this.quizCorrect = false;
    this.emit();
    return { done: false, chapterComplete: false };
  }

  /** Restores to a specific step within the current chapter — used when
   * resuming from server-persisted progress (a step already marked
   * completed server-side is skipped forward to, not replayed). */
  jumpToStep(stepId: string): boolean {
    const idx = this.getChapter().steps.findIndex((s) => s.id === stepId);
    if (idx < 0) return false;
    this.stepIndex = idx;
    this.requiredActionDone = false;
    this.quizAnswered = false;
    this.quizCorrect = false;
    this.emit();
    return true;
  }
}
