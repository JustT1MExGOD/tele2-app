/**
 * Desktop/PC presenter — persistent left chapter rail + right mission
 * panel around the real (spotlighted) app content, not a mobile sheet
 * stretched wide (see final report's "premium training environment /
 * game HUD" desktop target). Layout only — all behavior lives in
 * ui/shared/session.ts.
 */
export function renderDesktopShell(root: HTMLElement, chapterTitle: string, chapterSubtitle?: string): void {
  root.className = 'academy-shell academy-desktop';
  root.innerHTML = `
    <div class="academy-scrim"></div>
    <div class="academy-spotlight" hidden></div>
    <aside class="academy-nav-rail">
      <div class="academy-nav-brand">T2 ACADEMY</div>
      <div class="academy-chapter-title">${escapeHtml(chapterTitle)}</div>
      ${chapterSubtitle ? `<div class="academy-chapter-subtitle">${escapeHtml(chapterSubtitle)}</div>` : ''}
      <div class="academy-progress-dots-mount"></div>
      <button type="button" class="academy-close" onclick="__academyExit()">Выйти в приложение</button>
    </aside>
    <aside class="academy-mission-panel">
      <div class="academy-arbuzich"></div>
      <div class="academy-dialogue-mount"></div>
      <div class="academy-body-mount"></div>
      <div class="academy-practice-mount" hidden></div>
      <div class="academy-actions-mount"></div>
    </aside>`;
}

function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
