/**
 * Contextual lessons (T2 Academy §8) — "Впервые здесь? Показать за 30
 * секунд?" for a feature's first meaningful visit. Deliberately lives
 * OUTSIDE features/tutorial/ (that whole folder is the lazy-loaded Academy
 * bundle, see app/core.ts::loadAcademyBundle) — this file is small and
 * always-loaded (imported directly by the real feature pages), using only
 * the already-bridged window.apiClient.getAcademyContextualStatus/
 * dismissAcademyContextual and the lazy window.startAcademy() stub. The
 * actual Academy code only loads when the user taps "Показать", never
 * just from visiting a page that happens to offer a contextual lesson.
 */
export interface ContextualLessonOptions {
  contextId: string;
  title: string;
  role: string;
}

const PROMPT_ID = 'academyContextualPrompt';

/** Checks server-side dismissal state and, if not dismissed, shows the
 * prompt. Safe to call on every page load — one cheap GET, "once per
 * feature until dismissed" by design, never spams. */
export async function maybeShowContextualLesson(opts: ContextualLessonOptions): Promise<void> {
  try {
    const status = await window.apiClient.getAcademyContextualStatus(authHeaders(), opts.contextId);
    if (status.dismissed) return;
  } catch (_) {
    return; // best-effort — never blocks the real page on this fetch failing
  }
  renderPrompt(opts);
}

function renderPrompt(opts: ContextualLessonOptions): void {
  removeContextualPrompt();
  const el = document.createElement('div');
  el.id = PROMPT_ID;
  el.className = 'academy-contextual-prompt';
  el.innerHTML = `
    <div class="academy-contextual-icon">🍉</div>
    <div class="academy-contextual-body">
      <div class="academy-contextual-title">Впервые здесь? Показать «${esc(opts.title)}» за 30 секунд?</div>
      <div class="academy-contextual-actions">
        <button type="button" class="primary" data-action="show">Показать</button>
        <button type="button" data-action="later">Не сейчас</button>
        <button type="button" data-action="never">Больше не показывать</button>
      </div>
    </div>`;
  el.querySelector('[data-action="show"]')?.addEventListener('click', () => {
    removeContextualPrompt();
    void window.startAcademy(opts.role);
  });
  el.querySelector('[data-action="later"]')?.addEventListener('click', () => removeContextualPrompt());
  el.querySelector('[data-action="never"]')?.addEventListener('click', () => {
    removeContextualPrompt();
    window.apiClient.dismissAcademyContextual(authHeaders(true), opts.contextId).catch(() => {});
  });
  document.body.appendChild(el);
}

export function removeContextualPrompt(): void {
  document.getElementById(PROMPT_ID)?.remove();
}

function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
