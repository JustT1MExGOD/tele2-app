/**
 * Presentation-agnostic HTML builders shared by ui/mobile and ui/desktop —
 * this is the "share everything except layout" half of the mobile/desktop
 * split (see final report). Pure string builders, no DOM writes — callers
 * assign .innerHTML themselves so both presenters can place these blocks
 * in structurally different containers.
 */
import type { AcademyStep } from '../../model/types.js';
import { formatXpGain, badgeIcon } from '../../model/achievements.js';

function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function renderDialogue(step: AcademyStep): string {
  if (!step.say) return '';
  return `<div class="academy-dialogue">${esc(step.say)}</div>`;
}

export function renderStepBody(step: AcademyStep): string {
  if (!step.body) return '';
  return `<div class="academy-step-body">${esc(step.body)}</div>`;
}

export function renderPrimaryAction(label: string, disabled: boolean): string {
  return `<button type="button" class="btn-main academy-primary-action" ${disabled ? 'disabled' : ''} onclick="__academyAdvance()">${esc(label)}</button>`;
}

export function renderProgressDots(index: number, total: number): string {
  let out = '<div class="academy-progress-dots">';
  for (let i = 0; i < total; i++) {
    out += `<span class="academy-dot${i === index ? ' active' : ''}${i < index ? ' done' : ''}"></span>`;
  }
  return out + '</div>';
}

export function renderRewardReveal(xp: number, badgeTitle?: string): string {
  return `
    <div class="academy-reward-reveal">
      <div class="academy-reward-badge">${badgeTitle ? badgeIcon('') : '✨'}</div>
      ${badgeTitle ? `<div class="academy-reward-title">${esc(badgeTitle)}</div>` : ''}
      <div class="academy-reward-xp">${esc(formatXpGain(xp))}</div>
    </div>`;
}

export function primaryActionLabelForStep(step: AcademyStep, canAdvance: boolean, isLastStepOfChapter: boolean): string {
  if (isLastStepOfChapter) return 'Завершить главу';
  if (!canAdvance) {
    if (step.kind === 'discover') return 'Найди на экране';
    if (step.kind === 'practice' || step.kind === 'challenge') return 'Выполни задание';
    return 'Продолжить';
  }
  return 'Продолжить';
}
