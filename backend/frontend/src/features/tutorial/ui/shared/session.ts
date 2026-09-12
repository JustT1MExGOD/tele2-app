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
import { openTrainingSale } from '../game/training-sale.js';
import { getGame } from '../game/director.js';
import { TrainingShiftSandbox } from '../../practice/shift-practice.js';
import { renderDialogue, renderStepBody, renderProgressDots, renderRewardReveal, animateXpCounter, primaryActionLabelForStep } from './render.js';
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
  private shiftSandbox = new TrainingShiftSandbox();
  private checklistDone = new Set<string>();
  private salePracticeInFlight = false;
  private busy = false;
  private destroyed = false;
  private rewarded = false;
  private checklistInFlight = false;
  private abortController = new AbortController();
  private get game() { return getGame(this.refs.dialogueEl.closest<HTMLElement>('#academyRoot')); }
  private refreshSpotlight = () => this.renderSpotlight(this.engine.getStep());

  constructor(engine: TutorialEngine, arbuzich: ArbuzichController, headers: Record<string, string>, refs: AcademyMountRefs, onExit: () => void) {
    this.engine = engine;
    this.arbuzich = arbuzich;
    this.headers = headers;
    this.refs = refs;
    this.onExit = onExit;
  }

  start(): void {
    window.addEventListener('resize', this.refreshSpotlight);
    window.addEventListener('scroll', this.refreshSpotlight, true);
    if (this.refs.arbuzichEl) this.arbuzich.attach(this.refs.arbuzichEl);
    this.unsubscribeEngine = this.engine.subscribe(() => this.render());
    this.render();
  }

  destroy(): void {
    this.destroyed = true;
    this.abortController.abort();
    window.removeEventListener('resize', this.refreshSpotlight);
    window.removeEventListener('scroll', this.refreshSpotlight, true);
    this.unsubscribeEngine?.();
    this.arbuzich.destroy();
  }

  private render(): void {
    if (this.destroyed) return;
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
      this.checklistDone.clear();
      this.renderPracticeArea(step);
      this.lastRenderedStepId = step.id;
      const progress = this.engine.getStepProgress();
      this.game?.setStep(step, progress.index, progress.total);
      if (step.kind === 'quiz' && step.quiz) this.renderQuiz(step);
    }
    this.renderSpotlight(step);
    this.renderActions(step);
  }

  private renderQuiz(step: AcademyStep): void {
    const quiz = step.quiz!;
    this.refs.practiceEl.hidden = false;
    this.refs.practiceEl.innerHTML = '<div class="academy-quiz"></div>';
    const box = this.refs.practiceEl.firstElementChild!;
    const question = document.createElement('p'); question.textContent = quiz.question; box.append(question);
    const status = document.createElement('p'); status.setAttribute('role', 'status');
    quiz.options.forEach((option, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = option;
      button.onclick = () => { if (this.busy || this.destroyed) return; const ok = this.engine.answerQuiz(index); this.game?.feedback(ok); status.textContent = ok ? 'Верно! Можно двигаться дальше.' : 'Попробуй ещё раз — подумай о задании.'; };
      box.append(button);
    }); box.append(status);
  }

  private renderPracticeArea(step: AcademyStep): void {
    if (step.kind !== 'practice' && step.kind !== 'challenge') {
      this.refs.practiceEl.hidden = true;
      this.refs.practiceEl.innerHTML = '';
      return;
    }
    this.refs.practiceEl.hidden = false;
    const kind = step.practiceKind || 'replacement';
    switch (kind) {
      case 'sale':
        this.refs.practiceEl.innerHTML = `
          <div id="academyPracticeResult"></div>
          <button type="button" class="btn-main" onclick="__academyBeginSale()">Открыть учебную кассу</button>`;
        return;
      case 'shift-open':
        // Deliberately does NOT auto-complete from pre-existing sandbox
        // state (e.g. a shift left open by an earlier step/checklist item
        // sharing this session's one sandbox instance) — render() calls
        // this synchronously while still mid-render, and calling
        // markRequiredActionDone() from in here would re-enter render()
        // before lastRenderedStepId is even updated (infinite recursion).
        // Completion is exclusively driven by the explicit toggleShift()
        // click handler below.
        this.refs.practiceEl.innerHTML = this.stepRequiresAction(step)
          ? `<button type="button" class="btn-main" onclick="__academyToggleShift('open')">Открыть смену</button>`
          : `<div class="academy-practice-success">Смена открыта (тренировка)</div>`;
        return;
      case 'shift-close':
        this.refs.practiceEl.innerHTML = this.stepRequiresAction(step)
          ? `<button type="button" class="btn-main" onclick="__academyToggleShift('close')">Закрыть смену</button>`
          : `<div class="academy-practice-success">Смена закрыта (тренировка)</div>`;
        return;
      case 'checklist':
        this.renderChecklist(step);
        return;
      case 'replacement':
      default:
        this.refs.practiceEl.innerHTML = `
          <input type="text" id="academyPracticeCode" inputmode="numeric" placeholder="${TRAINING_STORE_CODE}" maxlength="10">
          <div id="academyPracticeResult"></div>
          <button type="button" class="btn-main" style="margin-top:8px" onclick="__academyCheckCode()">Проверить</button>`;
        return;
    }
  }

  private renderChecklist(step: AcademyStep): void {
    const items = step.checklist || [];
    this.refs.practiceEl.innerHTML = `
      <div class="academy-checklist">
        ${items
          .map(
            (item) => `
          <div class="academy-checklist-item${this.checklistDone.has(item.id) ? ' done' : ''}">
            <span class="academy-checklist-check">${this.checklistDone.has(item.id) ? '✓' : ''}</span>
            <span class="academy-checklist-label">${escapeHtml(item.label)}</span>
            ${this.checklistDone.has(item.id) ? '' : `<button type="button" class="academy-checklist-run" ${this.checklistInFlight || items.find((i) => !this.checklistDone.has(i.id))?.id !== item.id ? 'disabled' : ''} onclick="__academyChecklistItem('${item.id}')">Выполнить</button>`}
          </div>`
          )
          .join('')}
      </div>`;
  }

  checkPracticeCode(): void {
    const input = this.refs.practiceEl.querySelector<HTMLInputElement>('#academyPracticeCode');
    const resultEl = this.refs.practiceEl.querySelector<HTMLElement>('#academyPracticeResult');
    if (!input || !resultEl) return;
    const result = resolveTrainingStoreCode(input.value);
    if (!result.allowed || !result.store) {
      this.arbuzich.setState('mistake');
      this.game?.feedback(false);
      resultEl.innerHTML = `<div class="academy-practice-error">${escapeHtml(result.message || genericLine('mistake') || 'Не то')}</div>`;
      return;
    }
    this.arbuzich.setState('success');
    this.game?.feedback(true);
    resultEl.innerHTML = `
      <div class="academy-practice-success">
        <div class="academy-practice-store-name">${escapeHtml(result.store.name)}</div>
        <div class="academy-practice-store-addr">${escapeHtml(result.store.address)} · ${escapeHtml(result.store.network)}</div>
        <div class="academy-practice-sector-note">${escapeHtml(result.sectorNote || '')}</div>
        <div class="academy-practice-mode-note">Режим: ЗАМЕНА — график останется прежним, смена откроется на этой точке.</div>
      </div>`;
    this.engine.markRequiredActionDone();
  }

  async beginSalePractice(): Promise<void> {
    const step = this.engine.getStep();
    if (this.destroyed || this.busy || this.salePracticeInFlight || step.practiceKind !== 'sale' || !step.saleTarget || this.engine.canAdvance()) return;
    this.salePracticeInFlight = true;
    const resultEl = this.refs.practiceEl.querySelector<HTMLElement>('#academyPracticeResult');
    try {
      const result = await openTrainingSale(this.refs.practiceEl, step.saleTarget, this.abortController.signal);
      if (this.destroyed || this.engine.getStep() !== step || result.cancelled || !resultEl) return;
      if (result.matched) {
        this.arbuzich.setState('success');
    this.game?.feedback(true);
        resultEl.innerHTML = `<div class="academy-practice-success">Именно то, что нужно — миссия выполнена.</div>`;
        this.engine.markRequiredActionDone();
      } else {
        this.arbuzich.setState('mistake');
      this.game?.feedback(false);
        resultEl.innerHTML = `<div class="academy-practice-error">Не совсем — попробуй ещё раз с нужными метриками.</div>`;
      }
    } finally {
      this.salePracticeInFlight = false;
    }
  }

  toggleShift(action: 'open' | 'close'): void {
    if (this.destroyed || this.busy || this.engine.getStep().practiceKind !== `shift-${action}` || this.engine.canAdvance()) return;
    if (action === 'open') this.shiftSandbox.openShift();
    else this.shiftSandbox.closeShift();
    this.arbuzich.setState('success');
    this.game?.feedback(true);
    // markRequiredActionDone() emits -> re-enters render() -> since this is
    // NOT a step change, isNewStep is false, so it only refreshes
    // actions/spotlight, never re-invokes renderPracticeArea (no
    // re-entrancy risk here, unlike the render()-time check this replaced).
    this.engine.markRequiredActionDone();
    // Paint the "done" confirmation explicitly — this call happens from the
    // click handler's own stack, after markRequiredActionDone()'s render()
    // has already returned, so it's a plain re-render, not a recursive one.
    this.renderPracticeArea(this.engine.getStep());
  }

  /** True while the current practice/challenge step's required action has
   * not yet been performed — single source of truth (engine state), never
   * inspected mid-render from sandbox state directly (see shift-open/close
   * cases above for why that recursed). */
  private stepRequiresAction(_step: AcademyStep): boolean {
    return !this.engine.canAdvance();
  }

  async runChecklistItem(itemId: string): Promise<void> {
    const step = this.engine.getStep();
    const item = step.checklist?.find((i) => i.id === itemId);
    if (!item || this.destroyed || this.busy || this.checklistInFlight || step.practiceKind !== 'checklist' || step.checklist?.find((i) => !this.checklistDone.has(i.id))?.id !== itemId) return;
    this.checklistInFlight = true;
    this.renderChecklist(step);
    let ok = false;
    try { switch (item.kind) {
      case 'shift-open':
        this.shiftSandbox.openShift();
        ok = true;
        break;
      case 'shift-close':
        this.shiftSandbox.closeShift();
        ok = true;
        break;
      case 'sale': {
        const result = await openTrainingSale(this.refs.practiceEl, { sim: 1 }, this.abortController.signal);
        ok = result.matched;
        break;
      }
      case 'replacement':
        ok = false; // Для такого пункта требуется отдельная проверка ввода.
        break;
    }
    } finally { this.checklistInFlight = false; }
    if (this.destroyed || this.engine.getStep() !== step) return;
    this.renderChecklist(step);
    if (ok) {
      this.checklistDone.add(itemId);
      this.arbuzich.setState('success');
    this.game?.feedback(true);
      this.renderChecklist(step);
      if (step.checklist && step.checklist.every((i) => this.checklistDone.has(i.id))) {
        this.engine.markRequiredActionDone();
      }
    }
  }

  private renderSpotlight(step: AcademyStep): void {
    if (!this.refs.spotlightEl) return;
    if (step.kind !== 'discover' || !step.targetId) {
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
    const disabled = this.busy || !canAdvance;
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
    if (this.destroyed || this.busy || this.engine.getStep().kind !== 'discover') return;
    this.engine.markRequiredActionDone();
  }

  async advance(): Promise<void> {
    const step = this.engine.getStep();
    // Every step's completion is persisted server-side before the engine
    // moves on — reward amounts are looked up server-side by step.id
    // (core/academy/rewards.ts); the client never decides its own payout.
    if (this.destroyed || this.busy || this.rewarded || !this.engine.canAdvance()) return;
    this.busy = true;
    this.refs.actionsEl.querySelector('.academy-save-error')?.remove();
    this.renderActions(step);
    try {
    const result = await persistStepCompletion(this.headers, step.id);
    if (this.destroyed || this.engine.getStep() !== step) return;
    if (result.reward_granted) {
      this.rewarded = true;
      this.game?.reward();
      this.arbuzich.setState('chapter-complete');
      this.refs.dialogueEl.innerHTML = renderRewardReveal(result.xp_awarded, result.badge?.title);
      animateXpCounter(this.refs.dialogueEl);
      this.refs.bodyEl.innerHTML = '';
      this.refs.practiceEl.hidden = true;
      this.refs.actionsEl.innerHTML = `<button type="button" class="btn-main academy-primary-action" onclick="__academyBackToMap()">Вернуться на карту</button>`;
      return;
    }
    const { chapterComplete } = this.engine.advance();
    if (chapterComplete) {
      this.onExit();
    }
    } catch {
      if (!this.destroyed) {
        const error = document.createElement('p'); error.className = 'academy-save-error'; error.setAttribute('role', 'alert');
        error.textContent = 'Не удалось сохранить шаг. Проверь соединение и попробуй ещё раз.';
        this.refs.bodyEl.querySelector('.academy-save-error')?.remove(); this.refs.bodyEl.append(error);
      }
    } finally {
      this.busy = false;
      if (!this.destroyed && !this.rewarded) this.renderActions(this.engine.getStep());
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
