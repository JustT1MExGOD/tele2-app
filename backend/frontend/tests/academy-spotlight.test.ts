/**
 * T2 Academy — stable targeting via data-tutorial-id (never raw CSS
 * selectors), with graceful recovery when a target is missing.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { findTutorialTarget, getSpotlightRect } from '../src/features/tutorial/engine/spotlight.js';

const ORIGINAL_GET_RECT = HTMLElement.prototype.getBoundingClientRect;

describe('spotlight (stable data-tutorial-id targeting)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    HTMLElement.prototype.getBoundingClientRect = ORIGINAL_GET_RECT;
  });

  it('finds a real element by its data-tutorial-id', () => {
    document.body.innerHTML = '<div data-tutorial-id="academy-store-card">card</div>';
    const el = findTutorialTarget('academy-store-card');
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe('card');
  });

  it('a missing target returns null — no throw, graceful recovery', () => {
    document.body.innerHTML = '<div>unrelated</div>';
    expect(findTutorialTarget('academy-store-card')).toBeNull();
    expect(getSpotlightRect('academy-store-card')).toBeNull();
  });

  it('a target with zero size (not actually rendered/mounted) is treated as missing', () => {
    document.body.innerHTML = '<div data-tutorial-id="academy-store-card" style="display:none">card</div>';
    // jsdom returns a zero rect for any element regardless of display —
    // getSpotlightRect must not crash on that, only degrade to null.
    expect(() => getSpotlightRect('academy-store-card')).not.toThrow();
  });

  it('does not match a different data-tutorial-id (no accidental prefix/substring matches)', () => {
    document.body.innerHTML = '<div data-tutorial-id="academy-store-card-extra">x</div>';
    expect(findTutorialTarget('academy-store-card')).toBeNull();
  });

  it('when the same data-tutorial-id appears twice (desktop sidebar + mobile bottom-nav), the visible one wins', () => {
    document.body.innerHTML = `
      <button data-tutorial-id="academy-nav-schedule" style="display:none">desktop hidden</button>
      <button data-tutorial-id="academy-nav-schedule">mobile visible</button>
    `;
    // jsdom doesn't compute layout, but it DOES report a zero rect for
    // display:none — that's the exact signal getSpotlightRect already
    // treats as "not really there" elsewhere in this file.
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const hidden = this.style.display === 'none';
      return { top: 0, left: 0, width: hidden ? 0 : 40, height: hidden ? 0 : 40, bottom: 0, right: 0, x: 0, y: 0, toJSON() { return this; } } as DOMRect;
    };
    const el = findTutorialTarget('academy-nav-schedule');
    expect(el?.textContent).toBe('mobile visible');
  });

  it('a value containing a double quote is escaped safely rather than breaking the selector', () => {
    document.body.innerHTML = '<div data-tutorial-id="x">y</div>';
    expect(() => findTutorialTarget('x"][onclick="alert(1)')).not.toThrow();
    expect(findTutorialTarget('x"][onclick="alert(1)')).toBeNull();
  });
});
