import type { QualityProfile } from '../types.js';

const read = (key: string) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
const write = (key: string, value: boolean) => { try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* stays in-memory */ } };

/** Minimal corner HUD — a short objective pill (top-left) and small icon
 * buttons (top-right): sound, graphics quality, "reveal app" for
 * discover steps. Deliberately not a wide persistent panel or a giant
 * headline over the scene (brief §7/§1: the world should read as most of
 * the screen). */
export class Hud {
  private objective: HTMLDivElement;
  private toolbar: HTMLDivElement;
  private revealBtn: HTMLButtonElement;
  private interactHint: HTMLDivElement;
  muted = !read('t2-academy-3d-sound');
  quality: QualityProfile = read('t2-academy-3d-low') ? 'low' : 'high';
  onToggleSound: (() => void) | null = null;
  onToggleQuality: (() => void) | null = null;
  onReveal: (() => void) | null = null;

  constructor(private host: HTMLElement) {
    this.objective = document.createElement('div');
    this.objective.className = 'academy-3d-objective';
    this.objective.setAttribute('role', 'status');
    host.appendChild(this.objective);

    this.toolbar = document.createElement('div');
    this.toolbar.className = 'academy-3d-toolbar';
    this.toolbar.innerHTML = `
      <button type="button" data-hud="sound"></button>
      <button type="button" data-hud="quality"></button>
      <button type="button" data-hud="reveal" hidden>Показать приложение</button>`;
    host.appendChild(this.toolbar);
    this.revealBtn = this.toolbar.querySelector('[data-hud=reveal]')!;
    this.toolbar.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!btn) return;
      if (btn.dataset.hud === 'sound') { this.muted = !this.muted; write('t2-academy-3d-sound', !this.muted); this.onToggleSound?.(); this.render(); }
      if (btn.dataset.hud === 'quality') { this.quality = this.quality === 'high' ? 'low' : 'high'; write('t2-academy-3d-low', this.quality === 'low'); this.onToggleQuality?.(); this.render(); }
      if (btn.dataset.hud === 'reveal') this.onReveal?.();
    });

    this.interactHint = document.createElement('div');
    this.interactHint.className = 'academy-3d-interact-hint';
    this.interactHint.hidden = true;
    host.appendChild(this.interactHint);

    this.render();
  }

  private render(): void {
    const sound = this.toolbar.querySelector<HTMLButtonElement>('[data-hud=sound]')!;
    sound.textContent = this.muted ? '🔇' : '🔊';
    sound.setAttribute('aria-label', this.muted ? 'Включить звук' : 'Выключить звук');
    sound.setAttribute('aria-pressed', String(!this.muted));
    const quality = this.toolbar.querySelector<HTMLButtonElement>('[data-hud=quality]')!;
    quality.textContent = this.quality === 'high' ? 'HD' : 'ECO';
    quality.setAttribute('aria-label', 'Качество графики');
    quality.setAttribute('aria-pressed', String(this.quality === 'low'));
  }

  setObjective(text: string): void {
    this.objective.textContent = text;
  }

  setRevealVisible(visible: boolean): void {
    this.revealBtn.hidden = !visible;
    if (visible) this.revealBtn.textContent = 'Показать приложение';
  }

  setRevealLabel(compact: boolean): void {
    this.revealBtn.textContent = compact ? 'Вернуться к заданию' : 'Показать приложение';
    this.revealBtn.setAttribute('aria-expanded', String(compact));
  }

  setInteractHint(text: string | null, desktop: boolean): void {
    if (!text || !desktop) { this.interactHint.hidden = true; return; }
    this.interactHint.hidden = false;
    this.interactHint.innerHTML = `<kbd>E</kbd> ${text}`;
  }

  destroy(): void {
    this.objective.remove();
    this.toolbar.remove();
    this.interactHint.remove();
  }
}
