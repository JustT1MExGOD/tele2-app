/**
 * Navigation/window-open allowlist (§42/§43 of the brief). Only the
 * canonical origin is ever navigated to in-window; every other
 * navigation attempt and every window.open()-style request is blocked;
 * external links go through shell.openExternal only after explicit
 * scheme validation.
 */
import { shell, type BrowserWindow, type WebContents } from 'electron';

const ALLOWED_EXTERNAL_SCHEMES = new Set(['https:', 'mailto:']);

export function isSameOrigin(url: string, canonicalOrigin: string): boolean {
  try {
    return new URL(url).origin === new URL(canonicalOrigin).origin;
  } catch {
    return false;
  }
}

/** Validates a URL for shell.openExternal — only https:/mailto: after
 * real URL parsing (never a regex/startsWith check alone, which is easy
 * to bypass with e.g. "  javascript:..." or mixed-case schemes). */
export function isSafeExternalUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return ALLOWED_EXTERNAL_SCHEMES.has(parsed.protocol);
}

/**
 * Wires the allowlist onto one WebContents. DESK-05 (arbitrary domain
 * navigation blocked), DESK-06 (javascript: navigation blocked — a
 * javascript: URL fails isSameOrigin's `new URL()` parse in a way that
 * never matches the canonical origin, and separately fails
 * isSafeExternalUrl's scheme check, so it's blocked on both paths),
 * DESK-07 (unapproved new window blocked).
 */
export function applyNavigationPolicy(window: BrowserWindow, canonicalOrigin: string): void {
  const contents: WebContents = window.webContents;

  contents.on('will-navigate', (event, url) => {
    if (!isSameOrigin(url, canonicalOrigin)) {
      event.preventDefault();
    }
  });

  contents.setWindowOpenHandler(({ url }) => {
    if (isSameOrigin(url, canonicalOrigin)) {
      // Same-origin "new window" requests (none expected in normal use,
      // but if the app ever adds one) still never get a privileged
      // Electron window with a preload of their own — deny creating an
      // Electron BrowserWindow either way; if a same-origin popup is
      // ever genuinely needed, it gets a real, reviewed allow-with-
      // hardened-config path then, not by default here.
      return { action: 'deny' };
    }
    if (isSafeExternalUrl(url)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });
}
