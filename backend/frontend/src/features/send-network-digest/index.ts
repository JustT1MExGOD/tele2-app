/**
 * 20.12.0 (Frontend rewrite kickoff) — first real "feature" module: a
 * self-contained user action (button → API call → toast), wired via
 * addEventListener instead of an inline onclick= attribute. Genuinely
 * doesn't need `script-src-attr: 'unsafe-inline'` for this one button —
 * real (if small) progress toward the CSP tightening noted in
 * docs/SECURITY.md, not just a file move.
 */

export type DigestKind = 'weekly' | 'monthly';

export async function sendNetworkDigest(kind: DigestKind, buttonEl: HTMLButtonElement): Promise<void> {
  if (buttonEl.disabled) return;
  buttonEl.disabled = true;
  try {
    await window.apiClient.sendNetworkDigest(authHeaders(true), { kind });
    toast(kind === 'monthly' ? 'Месячная сводка отправлена' : 'Недельная сводка отправлена', 'ok');
  } catch (e: any) {
    toast(e?.message || 'Не удалось отправить сводку', 'err');
  } finally {
    buttonEl.disabled = false;
  }
}

/** Wires up every `[data-digest-kind]` button inside `container` — call after render. */
export function bindSendDigestButtons(container: ParentNode): void {
  container.querySelectorAll<HTMLButtonElement>('[data-digest-kind]').forEach((btn) => {
    const kind = btn.dataset.digestKind as DigestKind | undefined;
    if (!kind) return;
    btn.addEventListener('click', () => {
      sendNetworkDigest(kind, btn);
    });
  });
}
