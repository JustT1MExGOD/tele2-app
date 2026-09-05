/**
 * Update notification UI (§5 of the updater brief) — a small,
 * desktop-only card injected by the preload script, same technique and
 * same reasoning as preload/network-overlay.ts: the app loads the real
 * production frontend unmodified, so this is the only way to surface
 * anything update-related without touching shared frontend source.
 *
 * Sanitization guarantee, by construction: the only data this file ever
 * renders comes from `UpdateStatus` (main/updater/types.ts) — a manifest's
 * own public release fields (version/size/releaseNotes), sanitized
 * category strings, and hand-written error/warning messages this
 * process itself constructs. There is no code path by which a cookie,
 * token, credential, or raw exception/response body could reach this UI.
 *
 * User-confirmation invariant: this file NEVER calls `installUpdate()`
 * on its own — only a real click on the "Установить сейчас" button does,
 * and only when state is already 'ready_to_install'. There is no
 * auto-install timer, no force-install for `mandatory: true` (v1 policy
 * — see docs/DESKTOP-UPDATES.md's mandatory-update section — a mandatory
 * update is visually emphasized here, never silently forced).
 */
import type { T2DesktopAPI } from '../shared/ipc-contract';
import type { UpdateStatus } from '../main/updater/types';
import { FONT_STACK, RADIUS_CARD, SHADOW_CARD, ensureVisualTokenStyle } from './electron-visual-tokens';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  const units = ['КБ', 'МБ', 'ГБ'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

// Position/spacing stay inline (specific to this card's placement);
// color now comes from the .t2desktop-card class (electron-visual-tokens.ts,
// prefers-color-scheme aware) instead of a hardcoded dark-only background.
const CARD_STYLE =
  `position:fixed;bottom:8px;left:8px;z-index:2147483646;` +
  `font:13px/1.5 ${FONT_STACK};` +
  `padding:14px 16px;border-radius:${RADIUS_CARD};max-width:320px;` +
  `box-shadow:${SHADOW_CARD};`;

// Buttons use the shared .t2desktop-btn-primary/-secondary classes now —
// kept as class-name strings (not inline style strings) so a future
// light/dark tweak lives in electron-visual-tokens.ts, not duplicated here.
const BUTTON_CLASS_PRIMARY = 't2desktop-btn-primary';
const BUTTON_CLASS_SECONDARY = 't2desktop-btn-secondary';

/** Exported for testing — pure function producing the card's inner HTML
 * (or null when nothing should be shown), given a status and the
 * click-handler callbacks to wire up. Kept separate from DOM mounting so
 * the render LOGIC (which state shows what) is testable without a real
 * DOM. */
export function renderUpdateCardHtml(status: UpdateStatus): string | null {
  switch (status.state) {
    case 'not_configured':
    case 'up_to_date':
    case 'checking':
      return null; // nothing worth interrupting the user for

    case 'update_available': {
      const m = status.availableManifest;
      if (!m) return null;
      const mandatoryBadge = m.mandatory
        ? '<div style="color:#ef6c00;font-weight:700;font-size:11px;margin-bottom:4px;">ВАЖНОЕ ОБНОВЛЕНИЕ</div>'
        : '';
      const notes = m.releaseNotes
        ? `<div style="opacity:.75;font-size:12px;margin:6px 0;max-height:80px;overflow-y:auto;white-space:pre-wrap;">${esc(m.releaseNotes)}</div>`
        : '';
      return `
        ${mandatoryBadge}
        <div style="font-weight:700;margin-bottom:4px;">Доступна версия ${esc(m.version)}</div>
        <div style="opacity:.7;font-size:12px;">Размер: ${formatBytes(m.installer.size)}</div>
        ${notes}
        <div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;">
          <button data-t2-action="later" class="${BUTTON_CLASS_SECONDARY}">Позже</button>
          <button data-t2-action="download" class="${BUTTON_CLASS_PRIMARY}">Скачать</button>
        </div>`;
    }

    case 'downloading': {
      const p = status.progress;
      const pct = p && p.totalBytes > 0 ? Math.round((p.receivedBytes / p.totalBytes) * 100) : 0;
      return `
        <div style="font-weight:700;margin-bottom:6px;">Загрузка обновления…</div>
        <div style="background:#333;border-radius:4px;height:6px;overflow:hidden;">
          <div style="background:#2AABEE;height:100%;width:${pct}%;"></div>
        </div>
        <div style="opacity:.7;font-size:12px;margin-top:4px;">${p ? `${formatBytes(p.receivedBytes)} / ${formatBytes(p.totalBytes)}` : ''}</div>`;
    }

    case 'verifying': {
      const label =
        status.verificationStage === 'authenticode'
          ? 'Проверка цифровой подписи Windows…'
          : status.verificationStage === 'sha256'
            ? 'Проверка SHA-256…'
            : 'Проверка целостности файла…';
      return `<div style="font-weight:700;">${label}</div>`;
    }

    case 'ready_to_install': {
      const warning = status.signatureWarning
        ? `<div style="color:#ef6c00;font-size:12px;margin:4px 0;">${esc(status.signatureWarning)}</div>`
        : '';
      return `
        <div style="font-weight:700;margin-bottom:4px;">Обновление готово к установке</div>
        ${warning}
        <div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;">
          <button data-t2-action="later" class="${BUTTON_CLASS_SECONDARY}">Позже</button>
          <button data-t2-action="install" class="${BUTTON_CLASS_PRIMARY}">Установить сейчас</button>
        </div>`;
    }

    case 'error':
      return `
        <div style="font-weight:700;color:#c62828;margin-bottom:4px;">Ошибка обновления</div>
        <div style="opacity:.8;font-size:12px;">${esc(status.errorMessage ?? 'Неизвестная ошибка')}</div>
        <div style="margin-top:10px;display:flex;justify-content:flex-end;">
          <button data-t2-action="later" class="${BUTTON_CLASS_SECONDARY}">Скрыть</button>
        </div>`;

    default:
      return null;
  }
}

export function installUpdateNotification(api: T2DesktopAPI): void {
  const mount = () => {
    ensureVisualTokenStyle();
    const card = document.createElement('div');
    card.id = 't2desktop-update-notification';
    card.className = 't2desktop-card';
    card.style.cssText = CARD_STYLE;
    card.style.display = 'none';
    document.body.appendChild(card);

    let dismissedForState: string | null = null;

    const render = (status: UpdateStatus) => {
      // "Позже" hides the card for the remainder of THIS state only —
      // it reappears the moment state changes (e.g. the next periodic
      // check finds the same or a new update), never permanently
      // silenced, and never auto-reappears as a nagging re-prompt for
      // the SAME unchanged state either.
      if (dismissedForState === status.state) {
        card.style.display = 'none';
        return;
      }
      const html = renderUpdateCardHtml(status);
      if (!html) {
        card.style.display = 'none';
        return;
      }
      card.innerHTML = html;
      card.style.display = 'block';

      card.querySelector('[data-t2-action="later"]')?.addEventListener('click', () => {
        dismissedForState = status.state;
        card.style.display = 'none';
      });
      card.querySelector('[data-t2-action="download"]')?.addEventListener('click', () => {
        void api.downloadUpdate();
      });
      card.querySelector('[data-t2-action="install"]')?.addEventListener('click', () => {
        // The ONLY call site in this entire file that invokes
        // installUpdate() — always a direct result of this exact click,
        // never automatic, never on a timer, never for mandatory=true
        // either (v1 policy — see docs/DESKTOP-UPDATES.md).
        void api.installUpdate();
      });
    };

    api.getUpdateStatus().then(render);
    api.onUpdateStatusChanged((status) => {
      // Only a genuine state CHANGE clears a prior dismissal — a
      // same-state re-emit (e.g. a download-progress tick while still
      // 'downloading') must not un-hide a card the user just dismissed
      // for that same state.
      if (status.state !== dismissedForState) dismissedForState = null;
      render(status);
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
}
