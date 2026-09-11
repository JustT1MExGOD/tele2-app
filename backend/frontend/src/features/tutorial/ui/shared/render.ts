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
      <div class="academy-reward-xp" data-xp-target="${xp}">${esc(formatXpGain(0))}</div>
    </div>`;
}

/** Counts the reward-reveal's "+N XP" up from 0 to its target over a short
 * duration — a deliberate motion beat for the milestone moment (§5), not
 * used anywhere routine. Collapses to an instant jump under reduced
 * motion, matching every other Academy animation's behavior. */
export function animateXpCounter(container: ParentNode): void {
  const el = container.querySelector<HTMLElement>('[data-xp-target]');
  if (!el) return;
  const target = Number(el.dataset.xpTarget) || 0;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion || target <= 0) {
    el.textContent = formatXpGain(target);
    return;
  }
  const durationMs = 700;
  const start = performance.now();
  const tick = (now: number): void => {
    const t = Math.min(1, (now - start) / durationMs);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = formatXpGain(Math.round(target * eased));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
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
