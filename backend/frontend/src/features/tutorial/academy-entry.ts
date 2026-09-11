/**
 * T2 Academy bundle entry point — lazy-loaded (see app/core.ts's
 * loadAcademyBundle() stub, injected as a <script> tag only when the user
 * actually opens the Academy, never eagerly on every page load). Wires
 * the engine/model/character/presenter layers together and exposes the
 * window bridge the stub calls into.
 */
import { TutorialEngine } from './engine/tutorial-engine.js';
import { ArbuzichController } from './character/arbuzich-controller.js';
import { getCourseForRole } from './model/registry.js';
import { loadProgress } from './model/progress.js';
import { AcademySession, collectMountRefs } from './ui/shared/session.js';
import { renderMobileShell } from './ui/mobile/present.js';
import { renderDesktopShell } from './ui/desktop/present.js';
import { withLoadingScreen } from './ui/shared/loading-screen.js';

const DESKTOP_BREAKPOINT = 860;

let activeSession: AcademySession | null = null;

function isDesktopViewport(): boolean {
  return window.innerWidth >= DESKTOP_BREAKPOINT;
}

function ensureRoot(): HTMLElement {
  let root = document.getElementById('academyRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'academyRoot';
    document.body.appendChild(root);
  }
  return root;
}

export async function startAcademy(role: string): Promise<void> {
  if (typeof window.switchPage === 'function') window.switchPage('home');
  const course = getCourseForRole(role);
  if (!course || !course.chapters.length) {
    window.toast?.('Курс для этой роли пока не готов', 'err');
    return;
  }
  const root = ensureRoot();
  root.hidden = false;

  await withLoadingScreen(root, () => loadProgress(window.authHeaders ? window.authHeaders() : {}));

  const chapter = course.chapters[0];
  const engine = new TutorialEngine(course);
  const arbuzich = new ArbuzichController();

  const desktop = isDesktopViewport();
  if (desktop) renderDesktopShell(root, chapter.title, chapter.subtitle);
  else renderMobileShell(root, chapter.title, chapter.subtitle);

  const refs = collectMountRefs(root);
  const session = new AcademySession(
    engine,
    arbuzich,
    window.authHeaders ? window.authHeaders(true) : {},
    refs,
    () => exitAcademy()
  );
  activeSession = session;
  session.start();
}

function exitAcademy(): void {
  activeSession?.destroy();
  activeSession = null;
  const root = document.getElementById('academyRoot');
  if (root) {
    root.hidden = true;
    root.innerHTML = '';
  }
}

window.__academyStart = startAcademy;
window.__academyAdvance = () => { void activeSession?.advance(); };
window.__academyExit = () => exitAcademy();
window.__academyCheckCode = () => activeSession?.checkPracticeCode();
window.__academyConfirmDiscover = () => activeSession?.confirmDiscover();

declare global {
  interface Window {
    __academyAdvance: () => void;
    __academyExit: () => void;
    __academyCheckCode: () => void;
    __academyConfirmDiscover: () => void;
  }
}
