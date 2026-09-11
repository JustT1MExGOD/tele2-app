/**
 * T2 Academy §5 — reward-reveal XP counting animation
 * (render.ts::animateXpCounter). Renders the reveal markup at "+0 XP" and
 * ticks it up to the real target; collapses to an instant jump under
 * reduced motion, same as every other Academy animation.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderRewardReveal, animateXpCounter } from '../src/features/tutorial/ui/shared/render.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('animateXpCounter', () => {
  it('renderRewardReveal starts the counter at +0 XP with the real target stashed in a data attribute', () => {
    const container = document.createElement('div');
    container.innerHTML = renderRewardReveal(50, 'Первая замена');
    const el = container.querySelector('[data-xp-target]')!;
    expect(el.getAttribute('data-xp-target')).toBe('50');
    expect(el.textContent).toContain('0');
  });

  it('under reduced motion, jumps straight to the target with no animation frames', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduced-motion'), media: q } as MediaQueryList));
    const rafSpy = vi.fn();
    vi.stubGlobal('requestAnimationFrame', rafSpy);
    const container = document.createElement('div');
    container.innerHTML = renderRewardReveal(50);
    animateXpCounter(container);
    const el = container.querySelector('[data-xp-target]')!;
    expect(el.textContent).toContain('50');
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it('without reduced motion, counts up across animation frames to the exact target', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q } as MediaQueryList));
    let now = 0;
    vi.stubGlobal('performance', { now: () => now } as Performance);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });

    const container = document.createElement('div');
    container.innerHTML = renderRewardReveal(50);
    animateXpCounter(container);
    const el = container.querySelector('[data-xp-target]')!;
    expect(el.textContent).toContain('0');
    expect(frames.length).toBe(1);

    // Drive it to completion — each queued frame may enqueue the next.
    for (let i = 0; i < 60 && frames.length; i++) {
      now += 50;
      const cb = frames.shift()!;
      cb(now);
    }
    expect(el.textContent).toContain('50');
  });

  it('a zero-XP reward (no badge, purely cosmetic step) never schedules an animation frame', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q } as MediaQueryList));
    const rafSpy = vi.fn();
    vi.stubGlobal('requestAnimationFrame', rafSpy);
    const container = document.createElement('div');
    container.innerHTML = renderRewardReveal(0);
    animateXpCounter(container);
    expect(rafSpy).not.toHaveBeenCalled();
  });
});
