/**
 * T2 Academy — declarative course model. Course/chapter/step data is pure
 * data (no DOM logic) — engine/ consumes it, ui/mobile and ui/desktop
 * render it. See docs note at features/tutorial/index.ts for how this
 * relates to the OLD tutorial (kept intact, not replaced by this pass).
 */
export type AcademyStepKind = 'story' | 'discover' | 'practice' | 'challenge' | 'quiz' | 'cutscene';

export type ArbuzichCue =
  | 'idle' | 'enter' | 'exit' | 'talking' | 'explaining' | 'thinking'
  | 'waiting' | 'pointing' | 'celebrating' | 'success' | 'mistake'
  | 'hint' | 'surprised' | 'chapter-complete';

/** A DISCOVER/PRACTICE/CHALLENGE step points at a real control via a
 * stable data-tutorial-id — never a raw CSS selector (see spotlight.ts).
 * Every step's `id` is sent to POST /academy/progress/complete-step on
 * advance — reward amounts are looked up server-side by that same id
 * (core/academy/rewards.ts), never declared here: course data must not
 * be trusted to decide its own XP/badge payout. */
export interface AcademyStep {
  id: string;
  kind: AcademyStepKind;
  /** Арбузыч's line(s) for this step — spoken via character/dialogue.ts. */
  say?: string;
  /** Short step body text shown in the sheet/panel below the dialogue. */
  body?: string;
  /** data-tutorial-id of the real control this step is about (DISCOVER/PRACTICE/CHALLENGE). */
  targetId?: string;
  cue?: ArbuzichCue;
  /** For quiz steps. */
  quiz?: { question: string; options: string[]; correctIndex: number };
  /** Which sandboxed mission a PRACTICE/CHALLENGE step runs — selects
   * which practice/*.ts module ui/shared/session.ts hands the step off to.
   * Defaults to 'replacement' (the original Chapter 1 code-entry UI) when
   * omitted, so existing course data needs no change. 'checklist' powers
   * the multi-mission final challenge (see courses/employee/final.ts). */
  practiceKind?: 'replacement' | 'sale' | 'shift-open' | 'shift-close' | 'checklist';
  /** For practiceKind: 'sale' — the metric mix the sandboxed sale must match. */
  saleTarget?: Record<string, number>;
  /** For practiceKind: 'checklist' — an ordered list of sub-missions the
   * final challenge combines; each id matches one of the OTHER
   * practiceKind values, completed in this codebase's own UI without a
   * separate arrow pointing at each one. */
  checklist?: { id: string; label: string; kind: 'replacement' | 'sale' | 'shift-open' | 'shift-close' }[];
}

export interface AcademyChapter {
  id: string;
  title: string;
  subtitle?: string;
  steps: AcademyStep[];
}

export interface AcademyCourse {
  id: string;
  role: 'employee' | 'manager' | 'supervisor' | 'admin';
  title: string;
  chapters: AcademyChapter[];
}
