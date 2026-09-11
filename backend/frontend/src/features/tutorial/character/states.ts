import type { ArbuzichCue } from '../model/types.js';

export type { ArbuzichCue };

/** CSS class applied to the mascot element per state — driven by CSS
 * keyframes/transitions (styles.css), not a JS animation loop. Reuses the
 * existing tutCharBob/tutPulse keyframes already shipped for the old
 * tutorial where the motion is equivalent (idle/hint), adds a small new
 * set for enter/exit/celebrating. */
export const ARBUZICH_STATE_CLASS: Record<ArbuzichCue, string> = {
  idle: 'arb-idle',
  enter: 'arb-enter',
  exit: 'arb-exit',
  talking: 'arb-talking',
  explaining: 'arb-explaining',
  thinking: 'arb-thinking',
  waiting: 'arb-idle',
  pointing: 'arb-pointing',
  celebrating: 'arb-celebrating',
  success: 'arb-success',
  mistake: 'arb-mistake',
  hint: 'arb-hint',
  surprised: 'arb-surprised',
  'chapter-complete': 'arb-celebrating'
};

/** How long a one-shot state (not idle-looping) should hold before the
 * controller auto-returns to 'idle' — matches the CSS animation-duration
 * for each class 1:1 (kept in one place so JS and CSS can't drift apart
 * silently). */
export const ARBUZICH_STATE_DURATION_MS: Partial<Record<ArbuzichCue, number>> = {
  enter: 500,
  exit: 400,
  success: 700,
  mistake: 500,
  celebrating: 1200,
  surprised: 500,
  'chapter-complete': 1600
};
