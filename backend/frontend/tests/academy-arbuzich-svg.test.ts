/**
 * T2 Academy — production Арбузыч SVG renderer (§3): swappable, no new
 * dependency, distinct named parts each character state's CSS targets.
 */
import { describe, it, expect } from 'vitest';
import { arbuzichSvgMarkup } from '../src/features/tutorial/character/arbuzich-svg.js';

describe('arbuzichSvgMarkup', () => {
  it('produces valid, parseable SVG markup', () => {
    const container = document.createElement('div');
    container.innerHTML = arbuzichSvgMarkup();
    expect(container.querySelector('svg.arb-svg')).toBeTruthy();
  });

  it('includes every named part the CSS per-state rules target (arb-body/stripe/eye/mouth/brow)', () => {
    const container = document.createElement('div');
    container.innerHTML = arbuzichSvgMarkup();
    expect(container.querySelector('.arb-body')).toBeTruthy();
    expect(container.querySelectorAll('.arb-stripe').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.arb-eye').length).toBe(2);
    expect(container.querySelector('.arb-mouth')).toBeTruthy();
    expect(container.querySelectorAll('.arb-brow').length).toBe(2);
  });

  it('is marked aria-hidden — decorative, the spoken dialogue text carries the actual information', () => {
    const container = document.createElement('div');
    container.innerHTML = arbuzichSvgMarkup();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('is deterministic — calling it twice produces identical markup (no random ids/state)', () => {
    expect(arbuzichSvgMarkup()).toBe(arbuzichSvgMarkup());
  });
});
