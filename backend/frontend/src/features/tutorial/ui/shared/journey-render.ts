/**
 * Journey/map node rendering — shared HTML builder for both presenters.
 * ui/mobile wraps this in a straight vertical scroller; ui/desktop wraps
 * it in a staggered "path" layout (CSS alternates node alignment) — see
 * each present.ts for the actual layout classes. This file only knows
 * about node STATE (locked/unlocked/completed/current), never viewport.
 */
import type { ChapterNodeState } from '../../model/journey.js';

function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function renderJourneyNodes(nodes: ChapterNodeState[]): string {
  return nodes
    .map((n) => {
      const state = n.completed ? 'completed' : n.unlocked ? 'current' : 'locked';
      const icon = n.completed ? '✓' : n.unlocked ? String(n.index + 1) : '🔒';
      const clickable = n.unlocked;
      return `
        <button type="button"
          class="academy-journey-node academy-journey-node--${state}"
          ${clickable ? `onclick="__academyOpenChapter('${n.chapter.id}')"` : 'disabled'}>
          <div class="academy-journey-node-icon">${icon}</div>
          <div class="academy-journey-node-body">
            <div class="academy-journey-node-title">${esc(n.chapter.title)}</div>
            ${n.chapter.subtitle ? `<div class="academy-journey-node-subtitle">${esc(n.chapter.subtitle)}</div>` : ''}
            ${n.unlocked && !n.completed && n.stepsDone > 0 ? `<div class="academy-journey-node-progress">${n.stepsDone}/${n.stepsTotal}</div>` : ''}
          </div>
        </button>`;
    })
    .join('<div class="academy-journey-connector"></div>');
}

export function renderJourneyHeader(courseTitle: string, xpTotal: number, badgeCount: number): string {
  return `
    <div class="academy-journey-header">
      <div class="academy-journey-title">${esc(courseTitle)}</div>
      <div class="academy-journey-stats">
        <span class="academy-journey-xp">${xpTotal} XP</span>
        <span class="academy-journey-badges">🏅 ${badgeCount}</span>
      </div>
    </div>`;
}
