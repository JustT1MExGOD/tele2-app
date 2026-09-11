/**
 * Shared behavior for both presenters — DOM writes into whatever
 * container refs the platform shell hands over, so ui/mobile and
 * ui/desktop can arrange those containers completely differently while
 * sharing every bit of actual logic (step transitions, practice
 * validation, reward flow, character cue wiring). This is the "share
 * engine/model/progress/validation/character state/practice logic,
 * separate PRESENTATION" split from the design doc.
 */
import { TutorialEngine } from '../../engine/tutorial-engine.js';
import { getSpotlightRect } from '../../engine/spotlight.js';
import { ArbuzichController } from '../../character/arbuzich-controller.js';
import { genericLine } from '../../character/dialogue.js';
import { completeStep as persistStepCompletion } from '../../model/progress.js';
import { resolveTrainingStoreCode, TRAINING_STORE_CODE } from '../../practice/replacement-practice.js';
import { renderDialogue, renderStepBody, renderProgressDots, renderRewardReveal, primaryActionLabelForStep } from './render.js';
import type { AcademyStep } from '../../model/types.js';

export interface AcademyMountRefs {
  dialogueEl: HTMLElement;
  bodyEl: HTMLElement;
  practiceEl: HTMLElement;
  actionsEl: HTMLElement;
  progressEl: HTMLElement;
  arbuzichEl: HTMLElement | null;
  spotlightEl: HTMLElement | null;
}

export class AcademySession {
  private engine: TutorialEngine;
  private arbuzich: ArbuzichController;
  private headers: Record<string, string>;
  private refs: AcademyMountRefs;
  private onExit: () => void;
  private unsubscribeEngine: (() => void) | null = null;
  private lastRenderedStepId: string | null = null;

  constructor(engine: TutorialEngine, arbuzich: ArbuzichController, headers: Record<string, string>, refs: AcademyMountRefs, onExit: () => void) {
    this.engine = engine;
    this.arbuzich = arbuzich;
    this.headers = headers;
    this.refs = refs;
    this.onExit = onExit;
  }

  start(): void {
    if (this.refs.arbuzichEl) this.arbuzich.attach(this.refs.arbuzichEl);
    this.unsubscribeEngine = this.engine.subscribe(() => this.render());
    this.render();
  }

  destroy(): void {
    this.unsubscribeEngine?.();
    this.arbuzich.destroy();
  }

  private render(): void {
    const step = this.engine.getStep();
    // Rebuilding dialogue/body/practice on EVERY engine change (not just a
    // step change) would wipe out checkPracticeCode()'s own success/error
    // markup the instant it calls markRequiredActionDone() — that emits,
    // which re-enters render(). Only the step-identity-independent bits
    // (actions — canAdvance may have just flipped — and the spotlight,
    // idempotent either way) need to refresh on every engine change.
    const isNewStep = step.id !== this.lastRenderedStepId;
    if (isNewStep) {
      if (step.cue) this.arbuzich.setState(step.cue);
      this.refs.dialogueEl.innerHTML = renderDialogue(step);
      this.refs.bodyEl.innerHTML = renderStepBody(step);
      this.refs.progressEl.innerHTML = renderProgressDots(
        this.engine.getStepProgress().index,
        this.engine.getStepProgress().total
      );
      this.renderPracticeArea(step);
      this.lastRenderedStepId = step.id;
    }
    this.renderSpotlight(step);
    this.renderActions(step);
  }

  private renderPracticeArea(step: AcademyStep): void {
    if (step.kind === 'practice') {
      this.refs.practiceEl.hidden = false;
      this.refs.practiceEl.innerHTML = `
        <input type="text" id="academyPracticeCode" inputmode="numeric" placeholder="${TRAINING_STORE_CODE}" maxlength="10">
        <div id="academyPracticeResult"></div>
        <button type="button" class="btn-main" style="margin-top:8px" onclick="__academyCheckCode()">Проверить</button>`;
      return;
    }
    this.refs.practiceEl.hidden = true;
    this.refs.practiceEl.innerHTML = '';
  }

  checkPracticeCode(): void {
    const input = this.refs.practiceEl.querySelector<HTMLInputElement>('#academyPracticeCode');
    const resultEl = this.refs.practiceEl.querySelector<HTMLElement>('#academyPracticeResult');
    if (!input || !resultEl) return;
    const result = resolveTrainingStoreCode(input.value);
    if (!result.allowed || !result.store) {
      this.arbuzich.setState('mistake');
      resultEl.innerHTML = `<div class="academy-practice-error">${escapeHtml(result.message || genericLine('mistake') || 'Не то')}</div>`;
      return;
    }
    this.arbuzich.setState('success');
    resultEl.innerHTML = `
      <div class="academy-practice-success">
        <div class="academy-practice-store-name">${escapeHtml(result.store.name)}</div>
        <div class="academy-practice-store-addr">${escapeHtml(result.store.address)} · ${escapeHtml(result.store.network)}</div>
        <div class="academy-practice-sector-note">${escapeHtml(result.sectorNote || '')}</div>
        <div class="academy-practice-mode-note">Режим: ЗАМЕНА — график останется прежним, смена откроется на этой точке.</div>
      </div>`;
    this.engine.markRequiredActionDone();
  }

  private renderSpotlight(step: AcademyStep): void {
    if (!this.refs.spotlightEl) return;
    if (!step.targetId) {
      this.refs.spotlightEl.hidden = true;
      return;
    }
    const rect = getSpotlightRect(step.targetId);
    if (!rect) {
      // Graceful recovery — target not mounted (e.g. wrong page). Hide the
      // spotlight rather than crash; dialogue/body text still guides the user.
      this.refs.spotlightEl.hidden = true;
      return;
    }
    this.refs.spotlightEl.hidden = false;
    const pad = 6;
    this.refs.spotlightEl.style.top = `${rect.top - pad}px`;
    this.refs.spotlightEl.style.left = `${rect.left - pad}px`;
    this.refs.spotlightEl.style.width = `${rect.width + pad * 2}px`;
    this.refs.spotlightEl.style.height = `${rect.height + pad * 2}px`;
  }

  private renderActions(step: AcademyStep): void {
    const canAdvance = this.engine.canAdvance();
    const label = primaryActionLabelForStep(step, canAdvance, this.engine.isLastStepOfChapter());
    const disabled = step.kind === 'discover' ? false : !canAdvance;
    this.refs.actionsEl.innerHTML = `<button type="button" class="btn-main academy-primary-action" ${disabled ? 'disabled' : ''} onclick="__academyAdvance()">${escapeHtml(label)}</button>`;
    if (step.kind === 'discover') {
      // Discover steps are confirmed by the user, not gated behind a real
      // DOM click-listener (see final report — a deliberate scoping choice
      // for this pass, avoids target-timing/click-race fragility while
      // still requiring the user to actually look at the spotlighted area).
      this.refs.actionsEl.innerHTML += `<button type="button" class="btn-secondary academy-discover-confirm" onclick="__academyConfirmDiscover()">Нашёл!</button>`;
    }
  }

  confirmDiscover(): void {
    this.engine.markRequiredActionDone();
  }

  async advance(): Promise<void> {
    const step = this.engine.getStep();
    // Every step's completion is persisted server-side before the engine
    // moves on — reward amounts are looked up server-side by step.id
    // (core/academy/rewards.ts); the client never decides its own payout.
    const result = await persistStepCompletion(this.headers, step.id);
    if (result.reward_granted) {
      this.arbuzich.setState('chapter-complete');
      this.refs.dialogueEl.innerHTML = renderRewardReveal(result.xp_awarded, result.badge?.title);
      this.refs.bodyEl.innerHTML = '';
      this.refs.practiceEl.hidden = true;
      this.refs.actionsEl.innerHTML = `<button type="button" class="btn-main academy-primary-action" onclick="__academyExit()">Вернуться на карту</button>`;
      return;
    }
    const { chapterComplete } = this.engine.advance();
    if (chapterComplete) {
      this.onExit();
    }
  }

  exit(): void {
    this.onExit();
  }
}

/** Both presenters inject their own skeleton HTML (different DOM
 * arrangement) but reuse these same mount class names for the shared
 * content regions — this is what lets AcademySession stay presentation-
 * agnostic. */
export function collectMountRefs(root: HTMLElement): AcademyMountRefs {
  const q = <T extends HTMLElement>(cls: string) => root.querySelector<T>(`.${cls}`);
  return {
    dialogueEl: q('academy-dialogue-mount')!,
    bodyEl: q('academy-body-mount')!,
    practiceEl: q('academy-practice-mount')!,
    actionsEl: q('academy-actions-mount')!,
    progressEl: q('academy-progress-dots-mount')!,
    arbuzichEl: q('academy-arbuzich'),
    spotlightEl: q('academy-spotlight')
  };
}

function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
