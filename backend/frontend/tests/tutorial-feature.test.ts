/**
 * 21.x (Frontend rewrite continuation, batch of 13) — jsdom test for
 * frontend/js/10-tutorial.js → src/features/tutorial. Focused rather than
 * exhaustive (batch migration) — the step CONTENT (chapters/questions/copy)
 * is data, not logic; tests cover the state machine (start/next/skip/finish,
 * coach-step gating, practice/quiz scoring, dry-run practice-real) rather
 * than enumerating every step's text.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function setupGlobals(overrides: { role?: string } = {}) {
  document.body.innerHTML = `
    <div id="tutorialOverlay"></div>
    <div id="tutorialScreen"><div class="ts-inner"></div></div>
    <div id="tutBadge"></div>
    <div id="tutStepLabel"></div><div id="tutTitle"></div><div id="tutText"></div>
    <div id="tutProgressBar"></div><div id="tutDots"></div><div id="tutTask"></div>
    <button id="tutNextBtn"></button><button id="tutSkipBtn"></button><div id="tutPractice"></div>
    <div id="tsChapterLabel"></div><div id="tsTitle"></div><div id="tsText"></div>
    <div id="tsReward"></div><div id="tsPractice"></div><div id="tsDots"></div>
    <button id="tsNextBtn"></button><button id="tsSkipBtn"></button>
    <div class="nav-item" data-page="my"></div>
    <div class="bottom-nav"></div>
  `;
  vi.stubGlobal('toast', vi.fn());
  vi.stubGlobal('canManage', () => overrides.role === 'manager' || overrides.role === 'admin');
  vi.stubGlobal('isSupervisor', () => overrides.role === 'supervisor');
  vi.stubGlobal('switchPage', vi.fn());
  vi.stubGlobal('authHeaders', () => ({}));
  vi.stubGlobal('confettiBurst', vi.fn());
  vi.stubGlobal('openComboCalc', vi.fn());
  vi.stubGlobal('openAddSale', vi.fn());

  const tutorialComplete = vi.fn().mockResolvedValue({ ok: true });
  (window as any).apiClient = { tutorialComplete };
  return { tutorialComplete };
}

describe('Обучение (миграция frontend/js/10-tutorial.js → src/features/tutorial)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('startTutorial: employee — показывает cutscene-экран первого шага, бейдж "Сотрудник"', async () => {
    setupGlobals();
    const { startTutorial } = await import('../src/features/tutorial/index.js');
    startTutorial('employee');
    expect(document.getElementById('tutorialScreen')!.classList.contains('show')).toBe(true);
    expect(document.getElementById('tutBadge')!.textContent).toBe('Сотрудник');
    expect(document.getElementById('tsTitle')!.textContent).toBe('Здоро́во!');
  });

  it('startManagerTutorial: не manager/supervisor — toast err, курс не стартует', async () => {
    setupGlobals({ role: 'employee' });
    const { startManagerTutorial } = await import('../src/features/tutorial/index.js');
    startManagerTutorial();
    expect((globalThis as any).toast).toHaveBeenCalledWith('Курс manager только для управляющих', 'err');
    expect(document.getElementById('tutorialScreen')!.classList.contains('show')).toBe(false);
  });

  it('startManagerTutorial: manager — стартует курс с бейджем "Manager"', async () => {
    setupGlobals({ role: 'manager' });
    const { startManagerTutorial } = await import('../src/features/tutorial/index.js');
    startManagerTutorial();
    expect(document.getElementById('tutBadge')!.textContent).toBe('Manager');
  });

  it('nextTutorialStep: coach-шаг без выполненного задания — toast err, шаг не двигается', async () => {
    setupGlobals();
    const { startTutorial, nextTutorialStep } = await import('../src/features/tutorial/index.js');
    startTutorial('employee');
    nextTutorialStep(); // step 0 is cutscene (no action needed) -> advances to step 1 (coach)
    expect(document.getElementById('tutTitle')!.textContent).toBe('Нижняя навигация');
    nextTutorialStep(); // step 1 is coach, needs action -> blocked
    expect((globalThis as any).toast).toHaveBeenCalledWith('Сначала выполни задание шага', 'err');
    expect(document.getElementById('tutTitle')!.textContent).toBe('Нижняя навигация');
  });

  it('coach step: клик по подсвеченному элементу засчитывает задание, включает "Далее"', async () => {
    setupGlobals();
    const { startTutorial, nextTutorialStep } = await import('../src/features/tutorial/index.js');
    startTutorial('employee');
    nextTutorialStep(); // -> coach step (highlight nav-item[data-page="my"])
    const navItem = document.querySelector('.nav-item[data-page="my"]') as HTMLElement;
    navItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    expect((document.getElementById('tutNextBtn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('practice step (non-quiz): засчитывает нужный pid и разблокирует "Далее"', async () => {
    setupGlobals();
    const { startTutorial, nextTutorialStep, onTutPractice } = await import('../src/features/tutorial/index.js');
    startTutorial('employee');
    nextTutorialStep(); // step0(cutscene) -> step1(coach, needs nav click)
    (document.querySelector('.nav-item[data-page="my"]') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    nextTutorialStep(); // step1 -> step2(cutscene celebrate)
    nextTutorialStep(); // step2 -> step3(cutscene)
    nextTutorialStep(); // step3 -> step4(cutscene, practice:[{id:'shift'}])
    expect(document.getElementById('tsTitle')!.textContent).toBe('Открыть смену');
    expect((document.getElementById('tsNextBtn') as HTMLButtonElement).disabled).toBe(true);
    onTutPractice('shift');
    expect((document.getElementById('tsNextBtn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('quiz step: неверный ответ — toast err, шаг остаётся заблокирован; верный — засчитывает', async () => {
    setupGlobals({ role: 'manager' });
    const { startTutorial, nextTutorialStep, onTutPractice } = await import('../src/features/tutorial/index.js');
    startTutorial('manager');
    // manager track has no coach/practice-gated steps before the quiz —
    // 14 consecutive nextTutorialStep() calls reach it deterministically.
    for (let i = 0; i < 14; i++) nextTutorialStep();
    expect(document.getElementById('tsTitle')!.textContent).toBe('Проверка первая');
    onTutPractice('m1_bad');
    expect((globalThis as any).toast).toHaveBeenCalledWith('Мимо — подумай ещё разок', 'err');
    expect((document.getElementById('tsNextBtn') as HTMLButtonElement).disabled).toBe(true);
    onTutPractice('m1_ok');
    expect((document.getElementById('tsNextBtn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('skipTutorial: первое обучение сотрудника — нельзя пропустить', async () => {
    setupGlobals();
    const { startTutorial, skipTutorial } = await import('../src/features/tutorial/index.js');
    startTutorial('employee');
    skipTutorial();
    expect((globalThis as any).toast).toHaveBeenCalledWith('Первое обучение нельзя пропустить', 'err');
    expect(document.getElementById('tutorialScreen')!.classList.contains('show')).toBe(true);
  });

  it('skipTutorial: повторное обучение (t2_tutorial_done уже стоит) — можно пропустить', async () => {
    localStorage.setItem('t2_tutorial_done', '1');
    setupGlobals();
    const { startTutorial, skipTutorial } = await import('../src/features/tutorial/index.js');
    startTutorial('employee');
    skipTutorial();
    expect(document.getElementById('tutorialScreen')!.classList.contains('show')).toBe(false);
    expect((globalThis as any).toast).toHaveBeenCalledWith('Обучение закрыто', 'ok');
  });

  it('finishTutorial (via skip после done): не отправляет tutorialComplete', async () => {
    localStorage.setItem('t2_tutorial_done', '1');
    const { tutorialComplete } = setupGlobals();
    const { startTutorial, skipTutorial } = await import('../src/features/tutorial/index.js');
    startTutorial('employee');
    skipTutorial();
    expect(tutorialComplete).not.toHaveBeenCalled();
  });

  it('beginPracticeReal: включает __tutorialDryRun и открывает форму продажи', async () => {
    setupGlobals();
    const { beginPracticeReal } = await import('../src/features/tutorial/index.js');
    beginPracticeReal();
    expect((window as any).__tutorialDryRun).toBe(true);
    expect((globalThis as any).openAddSale).toHaveBeenCalled();
    expect(typeof (window as any).__tutorialDryRunCallback).toBe('function');
  });

  it('maybeOfferTutorial: t2_tutorial_done не стоит — запускает обучение через таймаут', async () => {
    vi.useFakeTimers();
    setupGlobals();
    const { maybeOfferTutorial } = await import('../src/features/tutorial/index.js');
    maybeOfferTutorial();
    vi.advanceTimersByTime(1000);
    expect(document.getElementById('tutorialScreen')!.classList.contains('show')).toBe(true);
    vi.useRealTimers();
  });

  it('maybeOfferTutorial: t2_tutorial_done уже стоит — не запускает', async () => {
    vi.useFakeTimers();
    localStorage.setItem('t2_tutorial_done', '1');
    setupGlobals();
    const { maybeOfferTutorial } = await import('../src/features/tutorial/index.js');
    maybeOfferTutorial();
    vi.advanceTimersByTime(1000);
    expect(document.getElementById('tutorialScreen')!.classList.contains('show')).toBe(false);
    vi.useRealTimers();
  });

  it('window.* мост — все 7 функций', async () => {
    setupGlobals();
    await import('../src/features/tutorial/index.js');
    for (const name of ['maybeOfferTutorial', 'startTutorial', 'startManagerTutorial', 'beginPracticeReal', 'nextTutorialStep', 'skipTutorial', 'onTutPractice']) {
      expect(typeof (window as any)[name]).toBe('function');
    }
  });
});
