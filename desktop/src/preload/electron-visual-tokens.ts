/**
 * Small, stable visual token set shared by network-overlay.ts and
 * update-notification.ts (20.58 Phase 2, §4). Deliberately NOT read from
 * the loaded page's own CSS custom properties — sharing those would mean
 * this preload UI depends on the frontend's internal token names ever
 * staying the same, which the "no dependency on arbitrary frontend
 * internals" instruction rules out. Values below are simply chosen to
 * *look* consistent with the app (same radius/shadow/font rhythm), not
 * wired to it.
 *
 * `FONT_STACK` deliberately leads with 'Google Sans', matching
 * index.html's own `--font` token — this is safe (not a frontend-internal
 * dependency) because these preload-injected elements are appended into
 * the SAME document the page's own @font-face rule applies to, so the
 * named font resolves correctly if it loaded; if it didn't, every
 * fallback below it is a universally available system font, identical to
 * what this file used before.
 */
export const FONT_STACK = "'Google Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export const RADIUS_CARD = '8px';
export const RADIUS_BUTTON = '6px';
export const SHADOW_CARD = '0 4px 16px rgba(0,0,0,.4)';

/** prefers-color-scheme is a standard, safe browser signal — not an IPC
 * round-trip into app state, so using it stays inside the "no risky IPC"
 * constraint while still giving these cards basic light/dark awareness. */
export const DARK_BG = '#1a1a1a';
export const DARK_TEXT = '#f0f0f0';
export const LIGHT_BG = '#ffffff';
export const LIGHT_TEXT = '#1a1a1a';
export const LIGHT_BORDER = '1px solid rgba(0,0,0,.08)';

let injected = false;

/** Injects one shared <style> block (once) providing a
 * `.t2desktop-card` class that resolves bg/text/border via
 * prefers-color-scheme, and a `.t2desktop-btn-primary` /
 * `.t2desktop-btn-secondary` pair — both preload UIs use these classes
 * instead of hand-rolled inline colors, so light/dark handling lives in
 * one place. */
export function ensureVisualTokenStyle(): void {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.id = 't2desktop-visual-tokens';
  style.textContent = `
    .t2desktop-card {
      background: ${DARK_BG};
      color: ${DARK_TEXT};
      border: none;
    }
    .t2desktop-btn-primary {
      background: #2AABEE; color: #fff; border: none;
      border-radius: ${RADIUS_BUTTON}; padding: 7px 14px;
      font-size: 13px; font-weight: 600; cursor: pointer;
    }
    .t2desktop-btn-secondary {
      background: transparent; color: #aaa; border: none;
      padding: 7px 10px; font-size: 13px; cursor: pointer;
    }
    @media (prefers-color-scheme: light) {
      .t2desktop-card {
        background: ${LIGHT_BG}; color: ${LIGHT_TEXT}; border: ${LIGHT_BORDER};
      }
      .t2desktop-btn-secondary { color: #666; }
    }
  `;
  document.head.appendChild(style);
}
