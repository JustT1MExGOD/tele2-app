/**
 * Арбузыч character state controller — CSS-class-driven (no canvas/Lottie/
 * Rive, see final report's justification), applies one state class to the
 * mascot element and auto-reverts one-shot states back to 'idle'. Kept
 * DOM-light and testable: `attach()` takes any element (or none, for pure
 * state-tracking tests).
 */
import type { ArbuzichCue } from './states.js';
import { ARBUZICH_STATE_CLASS, ARBUZICH_STATE_DURATION_MS } from './states.js';

const LOOPING_STATES: ReadonlySet<ArbuzichCue> = new Set(['idle', 'talking', 'explaining', 'thinking', 'waiting', 'pointing', 'hint']);

// Mobile haptic feedback (§6/§7) — a real device signal for a real
// outcome, not decoration on every state change. navigator.vibrate is a
// no-op (returns false, throws nothing) on desktop/unsupported browsers,
// so this needs no platform branch of its own.
const HAPTIC_PATTERN_MS: Partial<Record<ArbuzichCue, number | number[]>> = {
  success: 30,
  celebrating: [20, 40, 20],
  'chapter-complete': [20, 40, 20],
  mistake: [40, 30, 40]
};

function triggerHaptic(state: ArbuzichCue): void {
  const pattern = HAPTIC_PATTERN_MS[state];
  if (!pattern) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Best-effort only — never let a haptics call break the Academy flow.
  }
}

export class ArbuzichController {
  private el: HTMLElement | null = null;
  private state: ArbuzichCue = 'idle';
  private revertHandle: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(state: ArbuzichCue) => void>();

  attach(el: HTMLElement | null): void {
    this.el = el;
    this.applyClass();
  }

  subscribe(fn: (state: ArbuzichCue) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getState(): ArbuzichCue {
    return this.state;
  }

  setState(next: ArbuzichCue): void {
    if (this.revertHandle) {
      clearTimeout(this.revertHandle);
      this.revertHandle = null;
    }
    this.state = next;
    this.applyClass();
    triggerHaptic(next);
    for (const fn of this.listeners) fn(next);

    if (!LOOPING_STATES.has(next)) {
      const reduced = prefersReducedMotion();
      const duration = reduced ? 120 : ARBUZICH_STATE_DURATION_MS[next] ?? 600;
      this.revertHandle = setTimeout(() => this.setState('idle'), duration);
    }
  }

  private applyClass(): void {
    if (!this.el) return;
    for (const cls of Object.values(ARBUZICH_STATE_CLASS)) this.el.classList.remove(cls);
    this.el.classList.add(ARBUZICH_STATE_CLASS[this.state]);
  }

  destroy(): void {
    if (this.revertHandle) clearTimeout(this.revertHandle);
    this.listeners.clear();
    this.el = null;
  }
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}
