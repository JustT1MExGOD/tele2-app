import { TutorialEngine } from './engine/tutorial-engine.js';
import { ArbuzichController } from './character/arbuzich-controller.js';
import { getCourseForRole } from './model/registry.js';
import { loadProgress, getCachedProgress, clearProgressCache } from './model/progress.js';
import { computeJourney } from './model/journey.js';
import { AcademySession, collectMountRefs } from './ui/shared/session.js';
import { renderMobileShell, renderMobileJourney } from './ui/mobile/present.js';
import { renderDesktopShell, renderDesktopJourney } from './ui/desktop/present.js';
import { withLoadingScreen } from './ui/shared/loading-screen.js';
import type { AcademyCourse } from './model/types.js';

import { mountGame, destroyGame } from './ui/game/director.js';
let activeSession: AcademySession | null = null;
let activeCourse: AcademyCourse | null = null;
let generation = 0;
let opened = false;
let loading = false;
let returnFocus: HTMLElement | null = null;
let previousOverflow = '';
const inertState = new Map<HTMLElement, boolean>();
const isDesktopViewport = () => window.innerWidth >= 860;
function ensureRoot(): HTMLElement {
  let root = document.getElementById('academyRoot');
  if (!root) { root = document.createElement('div'); root.id = 'academyRoot'; document.body.append(root); }
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Академия T2'); root.tabIndex = -1;
  return root;
}
function stopScene() { activeSession?.destroy(); activeSession = null; const root = document.getElementById('academyRoot'); if (root) destroyGame(root); }
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); exitAcademy(); return; }
  if (event.key !== 'Tab') return;
  const root = ensureRoot();
  const elements = Array.from(root.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href],[tabindex="0"]')).filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  if (!elements.length) { event.preventDefault(); root.focus(); return; }
  const first = elements[0], last = elements[elements.length - 1];
  if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root)) { event.preventDefault(); first.focus(); }
}
export async function startAcademy(role: string): Promise<void> {
  const course = getCourseForRole(role);
  if (!course || !course.chapters.length) { window.toast?.('Курс для этой роли пока не готов', 'err'); return; }
  const token = ++generation; stopScene(); activeCourse = course; loading = true;
  const root = ensureRoot(); root.hidden = false;
  if (!opened) {
    opened = true; returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    for (const child of Array.from(document.body.children)) if (child instanceof HTMLElement && child !== root && !['SCRIPT', 'STYLE'].includes(child.tagName)) { inertState.set(child, child.inert); child.inert = true; }
    document.addEventListener('keydown', keyboard);
  }
  window.switchPage?.('home'); root.focus();
  try {
    await withLoadingScreen(root, () => loadProgress(window.authHeaders ? window.authHeaders() : {}));
    if (token !== generation || !opened) return;
    loading = false; renderJourney();
  } catch {
    if (token !== generation || !opened) return;
    loading = false; root.className = 'academy-shell';
    root.innerHTML = '<div class="academy-sheet"><h2>Не удалось загрузить обучение</h2><p>Проверь соединение и повтори попытку.</p><button type="button" class="btn-main">Повторить</button><button type="button" class="btn-secondary">Закрыть</button></div>';
    root.querySelector<HTMLButtonElement>('.btn-main')!.onclick = () => { void startAcademy(role); };
    root.querySelector<HTMLButtonElement>('.btn-secondary')!.onclick = exitAcademy; root.focus();
  }
}
function renderJourney(): void {
  if (!activeCourse || !opened) return;
  stopScene(); const root = ensureRoot(), progress = getCachedProgress();
  const nodes = computeJourney(activeCourse, progress?.completed_step_ids || []);
  const render = isDesktopViewport() ? renderDesktopJourney : renderMobileJourney;
  render(root, activeCourse.title, nodes, progress?.xp_total || 0, progress?.badges.length || 0);
  mountGame(root); root.focus();
}
function openChapter(chapterId: string): void {
  if (!activeCourse || !opened || loading) return;
  const node = computeJourney(activeCourse, getCachedProgress()?.completed_step_ids || []).find(n => n.chapter.id === chapterId);
  if (!node?.unlocked) return;
  stopScene(); const chapter = node.chapter, root = ensureRoot();
  const engine = new TutorialEngine({ ...activeCourse, chapters: [chapter] });
  if (!node.completed) { const next = chapter.steps.find(step => !getCachedProgress()?.completed_step_ids.includes(step.id)); if (next) engine.jumpToStep(next.id); }
  (isDesktopViewport() ? renderDesktopShell : renderMobileShell)(root, chapter.title, chapter.subtitle);
  mountGame(root);
  activeSession = new AcademySession(engine, new ArbuzichController(), window.authHeaders ? window.authHeaders(true) : {}, collectMountRefs(root), () => { void backToMap(); });
  activeSession.start(); root.focus();
}
async function backToMap(): Promise<void> {
  if (!opened || loading) return;
  const token = ++generation; loading = true; stopScene();
  try { await loadProgress(window.authHeaders ? window.authHeaders() : {}); } catch { window.toast?.('Не удалось обновить карту. Показан сохранённый прогресс.', 'err'); }
  if (token !== generation || !opened) return;
  loading = false; renderJourney();
}
function exitAcademy(): void {
  generation++; stopScene(); activeCourse = null; loading = false; clearProgressCache();
  const root = document.getElementById('academyRoot'); if (root) { root.hidden = true; root.innerHTML = ''; }
  if (opened) {
    opened = false; document.removeEventListener('keydown', keyboard); document.body.style.overflow = previousOverflow;
    for (const [element, inert] of inertState) element.inert = inert; inertState.clear();
    if (returnFocus?.isConnected) returnFocus.focus(); returnFocus = null;
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
