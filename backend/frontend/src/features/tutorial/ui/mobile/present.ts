/**
 * Mobile/Telegram presenter — full-screen cinematic overlay, bottom sheet
 * per step (see final report's "immersive, tactile, compact" mobile
 * target). Layout only — all behavior lives in ui/shared/session.ts.
 */
import { renderJourneyHeader, renderJourneyNodes } from '../shared/journey-render.js';
import { arbuzichSvgMarkup } from '../../character/arbuzich-svg.js';
import type { ChapterNodeState } from '../../model/journey.js';

/** Vertically scrolling journey — a straight connected path of chapter
 * nodes, layered depth via the same cinematic background as the loading
 * screen (see styles.css .academy-journey-mobile). */
export function renderMobileJourney(root: HTMLElement, courseTitle: string, nodes: ChapterNodeState[], xpTotal: number, badgeCount: number): void {
  root.className = 'academy-shell academy-journey academy-journey-mobile';
  root.innerHTML = `
    <div class="academy-loading-bg"></div>
    <button type="button" class="academy-close" onclick="__academyExit()" aria-label="Закрыть">✕</button>
    ${renderJourneyHeader(courseTitle, xpTotal, badgeCount)}
    <div class="academy-journey-scroll">
      <div class="academy-journey-path academy-journey-path--vertical">
        ${renderJourneyNodes(nodes)}
      </div>
    </div>`;
}

export function renderMobileShell(root: HTMLElement, chapterTitle: string, chapterSubtitle?: string): void {
  root.className = 'academy-shell academy-mobile';
  root.innerHTML = `
    <div class="academy-scrim"></div>
    <div class="academy-spotlight" hidden></div>
    <button type="button" class="academy-close" onclick="__academyExit()" aria-label="Закрыть">✕</button>
    <div class="academy-chapter-badge">
      <div class="academy-chapter-title">${escapeHtml(chapterTitle)}</div>
      ${chapterSubtitle ? `<div class="academy-chapter-subtitle">${escapeHtml(chapterSubtitle)}</div>` : ''}
    </div>
    <div class="academy-progress-dots-mount"></div>
    <div class="academy-sheet">
      <div class="academy-arbuzich">${arbuzichSvgMarkup()}</div>
      <div class="academy-dialogue-mount"></div>
      <div class="academy-body-mount"></div>
      <div class="academy-practice-mount" hidden></div>
      <div class="academy-actions-mount"></div>
    </div>`;
}

function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
