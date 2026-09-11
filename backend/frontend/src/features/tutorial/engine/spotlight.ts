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

export function findTutorialTarget(targetId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-tutorial-id="${cssEscape(targetId)}"]`);
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
