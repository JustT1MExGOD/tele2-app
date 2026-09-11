/**
 * T2 Academy — Арбузыч character state controller.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ArbuzichController } from '../src/features/tutorial/character/arbuzich-controller.js';
import { ARBUZICH_STATE_CLASS } from '../src/features/tutorial/character/states.js';

describe('ArbuzichController', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('applies exactly one state class to the attached element, removing all others', () => {
    const el = document.createElement('div');
    const c = new ArbuzichController();
    c.attach(el);
    c.setState('talking');
    expect(el.classList.contains(ARBUZICH_STATE_CLASS.talking)).toBe(true);
    expect(el.classList.contains(ARBUZICH_STATE_CLASS.idle)).toBe(false);

    c.setState('celebrating');
    expect(el.classList.contains(ARBUZICH_STATE_CLASS.celebrating)).toBe(true);
    expect(el.classList.contains(ARBUZICH_STATE_CLASS.talking)).toBe(false);
  });

  it('one-shot states (e.g. celebrating) auto-revert to idle after their configured duration', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    const c = new ArbuzichController();
    c.attach(el);
    c.setState('celebrating');
    expect(c.getState()).toBe('celebrating');
    vi.advanceTimersByTime(1300);
    expect(c.getState()).toBe('idle');
    expect(el.classList.contains(ARBUZICH_STATE_CLASS.idle)).toBe(true);
  });

  it('looping states (idle/talking/pointing/hint) do NOT auto-revert', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    const c = new ArbuzichController();
    c.attach(el);
    c.setState('pointing');
    vi.advanceTimersByTime(10000);
    expect(c.getState()).toBe('pointing');
  });

  it('reduced motion — one-shot revert duration is short (~120ms) instead of the full animation duration', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduced-motion'), media: q } as MediaQueryList));
    vi.useFakeTimers();
    const el = document.createElement('div');
    const c = new ArbuzichController();
    c.attach(el);
    c.setState('celebrating');
    vi.advanceTimersByTime(150);
    expect(c.getState()).toBe('idle');
  });

  it('subscribe() notifies listeners of every state change; the returned unsubscribe stops further notifications', () => {
    const c = new ArbuzichController();
    const seen: string[] = [];
    const unsub = c.subscribe((s) => seen.push(s));
    c.setState('thinking');
    c.setState('surprised');
    unsub();
    c.setState('mistake');
    expect(seen).toEqual(['thinking', 'surprised']);
  });

  it('works without an attached element (pure state tracking, no DOM required)', () => {
    const c = new ArbuzichController();
    c.setState('waiting');
    expect(c.getState()).toBe('waiting');
  });
});
