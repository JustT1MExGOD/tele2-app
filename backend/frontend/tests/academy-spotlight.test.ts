/**
 * T2 Academy — stable targeting via data-tutorial-id (never raw CSS
 * selectors), with graceful recovery when a target is missing.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { findTutorialTarget, getSpotlightRect } from '../src/features/tutorial/engine/spotlight.js';

describe('spotlight (stable data-tutorial-id targeting)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
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

  it('a value containing a double quote is escaped safely rather than breaking the selector', () => {
    document.body.innerHTML = '<div data-tutorial-id="x">y</div>';
    expect(() => findTutorialTarget('x"][onclick="alert(1)')).not.toThrow();
    expect(findTutorialTarget('x"][onclick="alert(1)')).toBeNull();
  });
});
