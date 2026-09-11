/**
 * T2 Academy — journey node rendering (mobile vertical path vs desktop
 * staggered path) and locked/unlocked/completed visual states.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeJourney } from '../src/features/tutorial/model/journey.js';
import { renderMobileJourney } from '../src/features/tutorial/ui/mobile/present.js';
import { renderDesktopJourney } from '../src/features/tutorial/ui/desktop/present.js';
import type { AcademyCourse } from '../src/features/tutorial/model/types.js';

function makeCourse(): AcademyCourse {
  return {
    id: 'test', role: 'employee', title: 'Сотрудник',
    chapters: [
      { id: 'c1', title: 'Глава 1', steps: [{ id: 'c1-a', kind: 'story' }] },
      { id: 'c2', title: 'Глава 2', steps: [{ id: 'c2-a', kind: 'story' }] }
    ]
  };
}

describe('T2 Academy journey rendering', () => {
  it('mobile journey uses a vertical path layout', () => {
    const root = document.createElement('div');
    const nodes = computeJourney(makeCourse(), []);
    renderMobileJourney(root, 'Сотрудник', nodes, 0, 0);
    expect(root.className).toContain('academy-journey-mobile');
    expect(root.querySelector('.academy-journey-path--vertical')).toBeTruthy();
    expect(root.querySelector('.academy-journey-path--staggered')).toBeNull();
  });

  it('desktop journey uses a staggered path layout and a persistent side panel', () => {
    const root = document.createElement('div');
    const nodes = computeJourney(makeCourse(), []);
    renderDesktopJourney(root, 'Сотрудник', nodes, 0, 0);
    expect(root.className).toContain('academy-journey-desktop');
    expect(root.querySelector('.academy-journey-path--staggered')).toBeTruthy();
    expect(root.querySelector('.academy-journey-side')).toBeTruthy();
  });

  it('the first (unlocked, incomplete) chapter node is clickable; the second (locked) node is disabled', () => {
    const root = document.createElement('div');
    const nodes = computeJourney(makeCourse(), []);
    renderMobileJourney(root, 'Сотрудник', nodes, 0, 0);
    const buttons = root.querySelectorAll('.academy-journey-node');
    expect(buttons[0].hasAttribute('disabled')).toBe(false);
    expect(buttons[0].getAttribute('onclick')).toContain("__academyOpenChapter('c1')");
    expect(buttons[1].hasAttribute('disabled')).toBe(true);
  });

  it('a completed chapter node shows the completed state class and a checkmark', () => {
    const root = document.createElement('div');
    const nodes = computeJourney(makeCourse(), ['c1-a']);
    renderMobileJourney(root, 'Сотрудник', nodes, 50, 1);
    const first = root.querySelector('.academy-journey-node');
    expect(first?.className).toContain('academy-journey-node--completed');
    expect(first?.textContent).toContain('✓');
  });

  it('XP total and badge count are reflected in the journey header', () => {
    const root = document.createElement('div');
    const nodes = computeJourney(makeCourse(), ['c1-a']);
    renderMobileJourney(root, 'Сотрудник', nodes, 110, 2);
    expect(root.textContent).toContain('110 XP');
    expect(root.textContent).toContain('2');
  });

  it('mobile and desktop render the SAME node states for identical progress — only layout differs', () => {
    const nodesA = computeJourney(makeCourse(), ['c1-a']);
    const rootMobile = document.createElement('div');
    const rootDesktop = document.createElement('div');
    renderMobileJourney(rootMobile, 'Сотрудник', nodesA, 50, 1);
    renderDesktopJourney(rootDesktop, 'Сотрудник', nodesA, 50, 1);
    const mobileTitles = Array.from(rootMobile.querySelectorAll('.academy-journey-node-title')).map((e) => e.textContent);
    const desktopTitles = Array.from(rootDesktop.querySelectorAll('.academy-journey-node-title')).map((e) => e.textContent);
    expect(mobileTitles).toEqual(desktopTitles);
  });

  it('regression: the desktop journey sidebar must stay positioned, or the (also-positioned) ambient background paints over it', () => {
    // Playwright visual QA caught this: .academy-loading-bg is
    // position:absolute; per CSS painting order a non-positioned sibling
    // always paints BEHIND any positioned sibling regardless of DOM
    // order, so an unpositioned .academy-journey-side (brand/title/XP)
    // was fully hidden on every desktop screenshot even though
    // getComputedStyle reported it visible with a correct rect. jsdom
    // doesn't apply styles.css, so this asserts the rule directly rather
    // than the (untestable here) resulting paint order.
    const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8');
    const rule = css.match(/\.academy-journey-desktop\s+\.academy-journey-side\s*\{[^}]*\}/);
    expect(rule).toBeTruthy();
    expect(rule![0]).toMatch(/position:\s*relative/);
  });
});
