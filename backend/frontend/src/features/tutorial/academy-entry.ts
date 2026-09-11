/**
 * T2 Academy bundle entry point — lazy-loaded (see app/core.ts's
 * loadAcademyBundle() stub, injected as a <script> tag only when the user
 * actually opens the Academy, never eagerly on every page load). Wires
 * the engine/model/character/presenter layers together and exposes the
 * window bridge the stub calls into.
 *
 * Flow: startAcademy(role) -> loading cinematic -> journey map (chapter
 * nodes, locked/unlocked/completed) -> pick an unlocked chapter -> runs
 * that one chapter through TutorialEngine/AcademySession as before ->
 * chapter completion returns to the (now up to date) map, not straight
 * out of the Academy.
 */
import { TutorialEngine } from './engine/tutorial-engine.js';
import { ArbuzichController } from './character/arbuzich-controller.js';
import { getCourseForRole } from './model/registry.js';
import { loadProgress, getCachedProgress } from './model/progress.js';
import { computeJourney } from './model/journey.js';
import { AcademySession, collectMountRefs } from './ui/shared/session.js';
import { renderMobileShell, renderMobileJourney } from './ui/mobile/present.js';
import { renderDesktopShell, renderDesktopJourney } from './ui/desktop/present.js';
import { withLoadingScreen } from './ui/shared/loading-screen.js';
import type { AcademyCourse } from './model/types.js';

const DESKTOP_BREAKPOINT = 860;

let activeSession: AcademySession | null = null;
let activeCourse: AcademyCourse | null = null;

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
  activeCourse = course;
  const root = ensureRoot();
  root.hidden = false;

  await withLoadingScreen(root, () => loadProgress(window.authHeaders ? window.authHeaders() : {}));
  renderJourney();
}

function renderJourney(): void {
  if (!activeCourse) return;
  const root = ensureRoot();
  const progress = getCachedProgress();
  const nodes = computeJourney(activeCourse, progress?.completed_step_ids || []);
  const xpTotal = progress?.xp_total || 0;
  const badgeCount = progress?.badges.length || 0;
  if (isDesktopViewport()) renderDesktopJourney(root, activeCourse.title, nodes, xpTotal, badgeCount);
  else renderMobileJourney(root, activeCourse.title, nodes, xpTotal, badgeCount);
}

function openChapter(chapterId: string): void {
  if (!activeCourse) return;
  const chapter = activeCourse.chapters.find((c) => c.id === chapterId);
  if (!chapter) return;
  const root = ensureRoot();
  // A single-chapter "sub-course" — TutorialEngine always runs chapters[0],
  // so running one chapter at a time from the map means handing it a
  // course shaped around just that chapter, not touching the engine's own
  // multi-chapter logic (unused here on purpose, see final report).
  const singleChapterCourse: AcademyCourse = { ...activeCourse, chapters: [chapter] };
  const engine = new TutorialEngine(singleChapterCourse);
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
    () => backToMap()
  );
  activeSession = session;
  session.start();
}

async function backToMap(): Promise<void> {
  activeSession?.destroy();
  activeSession = null;
  // Refresh from the server so the map reflects whatever was just
  // completed (and any reward XP/badge) before repainting it.
  await loadProgress(window.authHeaders ? window.authHeaders() : {}).catch(() => {});
  renderJourney();
}

function exitAcademy(): void {
  activeSession?.destroy();
  activeSession = null;
  activeCourse = null;
  const root = document.getElementById('academyRoot');
  if (root) {
    root.hidden = true;
    root.innerHTML = '';
  }
}

window.__academyStart = startAcademy;
window.__academyOpenChapter = (chapterId: string) => openChapter(chapterId);
window.__academyBackToMap = () => { void backToMap(); };
window.__academyAdvance = () => { void activeSession?.advance(); };
window.__academyExit = () => exitAcademy();
window.__academyCheckCode = () => activeSession?.checkPracticeCode();
window.__academyConfirmDiscover = () => activeSession?.confirmDiscover();
window.__academyBeginSale = () => { void activeSession?.beginSalePractice(); };
window.__academyToggleShift = (action: 'open' | 'close') => activeSession?.toggleShift(action);
window.__academyChecklistItem = (itemId: string) => { void activeSession?.runChecklistItem(itemId); };

declare global {
  interface Window {
    __academyOpenChapter: (chapterId: string) => void;
    __academyBackToMap: () => void;
    __academyAdvance: () => void;
    __academyExit: () => void;
    __academyCheckCode: () => void;
    __academyConfirmDiscover: () => void;
    __academyBeginSale: () => void;
    __academyToggleShift: (action: 'open' | 'close') => void;
    __academyChecklistItem: (itemId: string) => void;
  }
}
