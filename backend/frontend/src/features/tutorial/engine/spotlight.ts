/**
 * Stable targeting — every Academy step points at a real control via
 * data-tutorial-id, never a raw CSS selector (see docs/ARCHITECTURE.md's
 * general "no presentation-class coupling" principle, applied here to the
 * tutorial specifically). A CSS refactor that keeps the data-tutorial-id
 * attribute in place can never break a course.
 */
export interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * The SAME data-tutorial-id legitimately appears on more than one element
 * in this codebase — the desktop sidebar and mobile bottom-nav render
 * separate DOM nodes for the same logical destination (data-page), only
 * one of them visible at a time per CSS breakpoint. findTutorialTarget()
 * returns the first VISIBLE match (non-zero rendered rect — CSS
 * display:none collapses to a zero rect, which is exactly the signal
 * used elsewhere in this file for "not really there"), never just the
 * first DOM match, so targeting a nav item works correctly on both
 * mobile and desktop without two different course step ids.
 */
export function findTutorialTarget(targetId: string): HTMLElement | null {
  const matches = document.querySelectorAll<HTMLElement>(`[data-tutorial-id="${cssEscape(targetId)}"]`);
  for (let i = 0; i < matches.length; i++) {
    const el = matches[i];
    const r = el.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) return el;
  }
  return matches[0] || null;
}

/** Graceful recovery — a missing target (page not mounted yet, control
 * hidden by role, timing) never throws; callers get null and degrade to
 * "no spotlight, dialogue-only" rather than crashing the Academy. */
export function getSpotlightRect(targetId: string): SpotlightRect | null {
  const el = findTutorialTarget(targetId);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}
