/**
 * Desktop/PC presenter — persistent left chapter rail + right mission
 * panel around the real (spotlighted) app content, not a mobile sheet
 * stretched wide (see final report's "premium training environment /
 * game HUD" desktop target). Layout only — all behavior lives in
 * ui/shared/session.ts.
 */
import { renderJourneyHeader, renderJourneyNodes } from '../shared/journey-render.js';
import { arbuzichSvgMarkup } from '../../character/arbuzich-svg.js';
import type { ChapterNodeState } from '../../model/journey.js';

/** Wide staggered "world map" path — CSS alternates node alignment
 * left/right (academy-journey-path--staggered) for a genuinely different
 * feel from mobile's straight vertical scroller, not the same list wider. */
export function renderDesktopJourney(root: HTMLElement, courseTitle: string, nodes: ChapterNodeState[], xpTotal: number, badgeCount: number): void {
  root.className = 'academy-shell academy-journey academy-journey-desktop';
  root.innerHTML = `
    <div class="academy-loading-bg"></div>
    <aside class="academy-journey-side">
      <div class="academy-nav-brand">T2 ACADEMY</div>
      ${renderJourneyHeader(courseTitle, xpTotal, badgeCount)}
      <button type="button" class="academy-close" onclick="__academyExit()">Выйти в приложение</button>
    </aside>
    <div class="academy-journey-scroll">
      <div class="academy-journey-path academy-journey-path--staggered">
        ${renderJourneyNodes(nodes)}
      </div>
    </div>`;
}

export function renderDesktopShell(root: HTMLElement, chapterTitle: string, chapterSubtitle?: string): void {
  root.className = 'academy-shell academy-desktop';
  root.innerHTML = `
    <div class="academy-scrim"></div>
    <div class="academy-spotlight" hidden></div>
    <aside class="academy-nav-rail">
      <div class="academy-nav-brand">T2 ACADEMY</div>
      <div class="academy-chapter-title">${escapeHtml(chapterTitle)}</div>
      ${chapterSubtitle ? `<div class="academy-chapter-subtitle">${escapeHtml(chapterSubtitle)}</div>` : ''}
      <div class="academy-progress-dots-mount"></div>
      <button type="button" class="academy-close" onclick="__academyExit()">Выйти в приложение</button>
    </aside>
    <aside class="academy-mission-panel">
      <div class="academy-arbuzich">${arbuzichSvgMarkup()}</div>
      <div class="academy-dialogue-mount"></div>
      <div class="academy-body-mount"></div>
      <div class="academy-practice-mount" hidden></div>
      <div class="academy-actions-mount"></div>
    </aside>`;
}

function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
