/** Compact bottom-center subtitle dialogue box — the brief explicitly
 * rejects the old giant headline-over-scene treatment in favor of short,
 * readable Russian subtitles. First tap/click/Space while typing reveals
 * the full line instantly; the next press advances to the next line (or
 * resolves the returned promise on the last line). The typewriter can be
 * turned off entirely (persisted), which must not remove the ability to
 * advance — only the animation. */
const TYPEWRITER_MS_PER_CHAR = 18;

function readSkip(): boolean {
  try { return localStorage.getItem('t2-academy-3d-skip-typewriter') === '1'; } catch { return false; }
}

export class DialogueBox {
  private el: HTMLDivElement;
  private nameEl: HTMLDivElement;
  private textEl: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private skipToggle: HTMLButtonElement;
  private skipTypewriter = readSkip();
  private typing = false;
  private resolveAdvance: (() => void) | null = null;
  private charTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'academy-3d-dialogue';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="academy-3d-dialogue-name"></div>
      <div class="academy-3d-dialogue-text" role="status" aria-live="polite"></div>
      <div class="academy-3d-dialogue-hint">Нажми, чтобы продолжить</div>
      <button type="button" class="academy-3d-dialogue-skip" aria-pressed="false">Аа</button>`;
    host.appendChild(this.el);
    this.nameEl = this.el.querySelector('.academy-3d-dialogue-name')!;
    this.textEl = this.el.querySelector('.academy-3d-dialogue-text')!;
    this.hintEl = this.el.querySelector('.academy-3d-dialogue-hint')!;
    this.skipToggle = this.el.querySelector('.academy-3d-dialogue-skip')!;
    this.skipToggle.setAttribute('aria-pressed', String(this.skipTypewriter));
    this.skipToggle.title = 'Отключить анимацию печати текста';
    this.skipToggle.onclick = (e) => {
      e.stopPropagation();
      this.skipTypewriter = !this.skipTypewriter;
      this.skipToggle.setAttribute('aria-pressed', String(this.skipTypewriter));
      try { localStorage.setItem('t2-academy-3d-skip-typewriter', this.skipTypewriter ? '1' : '0'); } catch { /* setting stays in-memory */ }
    };
    this.el.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.academy-3d-dialogue-skip')) return;
      this.advance();
    });
  }

  get visible(): boolean { return !this.el.hidden; }

  private advance(): void {
    if (this.typing) {
      if (this.charTimer) clearInterval(this.charTimer);
      this.typing = false;
      this.textEl.textContent = this.fullText;
      return;
    }
    const resolve = this.resolveAdvance;
    this.resolveAdvance = null;
    resolve?.();
  }

  private fullText = '';

  private showLine(speaker: string, text: string): Promise<void> {
    this.nameEl.textContent = speaker;
    this.fullText = text;
    this.el.hidden = false;
    return new Promise((resolve) => {
      this.resolveAdvance = resolve;
      if (this.skipTypewriter || prefersReducedMotion()) {
        this.typing = false;
        this.textEl.textContent = text;
        return;
      }
      this.typing = true;
      this.textEl.textContent = '';
      let i = 0;
      this.charTimer = setInterval(() => {
        i++;
        this.textEl.textContent = text.slice(0, i);
        if (i >= text.length) { if (this.charTimer) clearInterval(this.charTimer); this.typing = false; }
      }, TYPEWRITER_MS_PER_CHAR);
    });
  }

  async say(speaker: string, lines: string[]): Promise<void> {
    for (const line of lines) await this.showLine(speaker, line);
  }

  hide(): void {
    if (this.charTimer) clearInterval(this.charTimer);
    this.typing = false;
    const resolve = this.resolveAdvance;
    this.resolveAdvance = null;
    resolve?.();
    this.el.hidden = true;
  }

  destroy(): void {
    if (this.charTimer) clearInterval(this.charTimer);
    this.el.remove();
  }
}

function prefersReducedMotion(): boolean {
  try { return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true; } catch { return false; }
}
