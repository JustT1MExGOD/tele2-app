/**
 * Admin Control Center (20.59.0) — shared dangerous-action confirm dialog
 * and step-up MFA prompt. Both reuse the app's single shared modal
 * (#overlay/#modalTitle/#modalBody, see index.html's "единая модалка на
 * всё приложение" comment) rather than inventing new overlay chrome.
 *
 * No inline onclick=/onchange= in the injected markup — every button is
 * wired via addEventListener after innerHTML is set, per
 * check-inline-event-handlers.mjs's zero-headroom baseline.
 */

export interface ConfirmDangerousActionOptions {
  title: string;
  description: string;
  previewHtml?: string;
  confirmLabel?: string;
}

/** Returns the trimmed reason on confirm, or null if cancelled / left empty. */
export function confirmDangerousAction(opts: ConfirmDangerousActionOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    if (!modalTitle || !modalBody) {
      resolve(null);
      return;
    }
    modalTitle.textContent = opts.title;
    modalBody.innerHTML = `
      <div class="section" style="padding:0">
        <p style="padding:0 16px;color:var(--text-secondary,#8e8e93)">${esc(opts.description)}</p>
        ${opts.previewHtml ? `<div style="padding:0 16px">${opts.previewHtml}</div>` : ''}
        <div style="padding:0 16px">
          <textarea id="dangerActionReason" rows="3" placeholder="Причина (обязательно)" style="width:100%;box-sizing:border-box;resize:vertical"></textarea>
        </div>
        <div style="padding:12px 16px;display:flex;gap:8px;justify-content:flex-end">
          <button type="button" class="btn-ghost" id="dangerActionCancel">Отмена</button>
          <button type="button" class="btn-main" id="dangerActionConfirm">${esc(opts.confirmLabel || 'Подтвердить')}</button>
        </div>
      </div>
    `;

    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      closeModal();
      resolve(value);
    };

    const textarea = document.getElementById('dangerActionReason') as HTMLTextAreaElement | null;
    document.getElementById('dangerActionCancel')?.addEventListener('click', () => finish(null));
    document.getElementById('dangerActionConfirm')?.addEventListener('click', () => {
      const reason = (textarea?.value || '').trim();
      if (!reason) {
        toast('Укажите причину', 'err');
        return;
      }
      finish(reason);
    });
    document.getElementById('modalCloseBtn')?.addEventListener('click', () => finish(null), { once: true });

    if (typeof openModal === 'function') openModal();
    textarea?.focus();
  });
}

/** Prompts for a TOTP code and exchanges it for a step-up ticket via
 * POST /auth/mfa/step-up. Returns the ticket, or null if cancelled/failed. */
export function requestStepUpTicket(): Promise<string | null> {
  return new Promise((resolve) => {
    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    if (!modalTitle || !modalBody) {
      resolve(null);
      return;
    }
    modalTitle.textContent = 'Подтверждение MFA';
    modalBody.innerHTML = `
      <div class="section" style="padding:0">
        <p style="padding:0 16px;color:var(--text-secondary,#8e8e93)">Это опасное действие требует свежего подтверждения через приложение-аутентификатор.</p>
        <div style="padding:0 16px">
          <input type="text" id="stepUpCode" inputmode="numeric" placeholder="Код из приложения" style="width:100%;box-sizing:border-box">
        </div>
        <div style="padding:12px 16px;display:flex;gap:8px;justify-content:flex-end">
          <button type="button" class="btn-ghost" id="stepUpCancel">Отмена</button>
          <button type="button" class="btn-main" id="stepUpConfirm">Подтвердить</button>
        </div>
      </div>
    `;

    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      closeModal();
      resolve(value);
    };

    const input = document.getElementById('stepUpCode') as HTMLInputElement | null;
    document.getElementById('stepUpCancel')?.addEventListener('click', () => finish(null));
    document.getElementById('stepUpConfirm')?.addEventListener('click', async () => {
      const code = (input?.value || '').trim();
      if (!code) {
        toast('Введите код', 'err');
        return;
      }
      try {
        const res = await window.apiClient.issueStepUpTicket(authHeaders(true), 'totp', code);
        finish(res.step_up_token);
      } catch (e) {
        toast('Неверный код', 'err');
      }
    });
    document.getElementById('modalCloseBtn')?.addEventListener('click', () => finish(null), { once: true });

    if (typeof openModal === 'function') openModal();
    input?.focus();
  });
}
