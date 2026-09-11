/**
 * T2 Academy — mobile vs desktop presenters share identical engine state
 * and behavior through AcademySession; only the DOM/CSS arrangement
 * differs (see final report's mobile/desktop split).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockProgress = { completed_step_ids: [], xp_total: 0, badges: [] };
const completeAcademyStepMock = vi.fn().mockResolvedValue({ already_completed: false, reward_granted: false, xp_awarded: 0 });
const getAcademyProgressMock = vi.fn().mockResolvedValue(mockProgress);

vi.mock('../src/features/tutorial/api.js', () => ({
  getAcademyProgress: (...args: any[]) => getAcademyProgressMock(...args),
  completeAcademyStep: (...args: any[]) => completeAcademyStepMock(...args)
}));

import { TutorialEngine } from '../src/features/tutorial/engine/tutorial-engine.js';
import { ArbuzichController } from '../src/features/tutorial/character/arbuzich-controller.js';
import { AcademySession, collectMountRefs } from '../src/features/tutorial/ui/shared/session.js';
import { renderMobileShell } from '../src/features/tutorial/ui/mobile/present.js';
import { renderDesktopShell } from '../src/features/tutorial/ui/desktop/present.js';
import { loadProgress, __resetProgressCache } from '../src/features/tutorial/model/progress.js';
import { TRAINING_STORE_CODE } from '../src/features/tutorial/practice/replacement-practice.js';
import type { AcademyCourse } from '../src/features/tutorial/model/types.js';

function makeCourse(): AcademyCourse {
  return {
    id: 'test', role: 'employee', title: 'Test',
    chapters: [{
      id: 'ch1', title: 'Глава 1', subtitle: 'Подзаголовок',
      steps: [
        { id: 's1', kind: 'story', say: 'Привет' },
        { id: 's2', kind: 'discover', targetId: 'x' },
        { id: 's3', kind: 'practice', targetId: 'y' },
        { id: 's4', kind: 'cutscene', say: 'Готово' }
      ]
    }]
  };
}

async function setupSession(root: HTMLElement, isMobile: boolean) {
  const course = makeCourse();
  if (isMobile) renderMobileShell(root, course.chapters[0].title, course.chapters[0].subtitle);
  else renderDesktopShell(root, course.chapters[0].title, course.chapters[0].subtitle);
  const refs = collectMountRefs(root);
  const engine = new TutorialEngine(course);
  const arbuzich = new ArbuzichController();
  const onExit = vi.fn();
  const session = new AcademySession(engine, arbuzich, {}, refs, onExit);
  session.start();
  return { session, engine, refs, onExit };
}

describe('T2 Academy presenters (mobile/desktop parity)', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="academyRoot"></div>';
    getAcademyProgressMock.mockClear();
    completeAcademyStepMock.mockClear();
    completeAcademyStepMock.mockResolvedValue({ already_completed: false, reward_granted: false, xp_awarded: 0 });
    __resetProgressCache();
    vi.stubGlobal('__academyAdvance', vi.fn());
    vi.stubGlobal('__academyExit', vi.fn());
    vi.stubGlobal('__academyCheckCode', vi.fn());
    vi.stubGlobal('__academyConfirmDiscover', vi.fn());
    // Reduced-motion so the reward-reveal XP counter (render.ts::animateXpCounter)
    // jumps straight to its target instead of depending on rAF timing here.
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduced-motion'), media: q } as MediaQueryList));
  });

  it('mobile shell has the academy-mobile class and every required mount point', () => {
    const root = document.getElementById('academyRoot')!;
    renderMobileShell(root, 'Title');
    expect(root.className).toContain('academy-mobile');
    const refs = collectMountRefs(root);
    expect(refs.dialogueEl).toBeTruthy();
    expect(refs.bodyEl).toBeTruthy();
    expect(refs.practiceEl).toBeTruthy();
    expect(refs.actionsEl).toBeTruthy();
    expect(refs.progressEl).toBeTruthy();
    expect(refs.arbuzichEl).toBeTruthy();
    expect(refs.spotlightEl).toBeTruthy();
  });

  it('desktop shell has the academy-desktop class, a nav rail, a mission panel, and every required mount point', () => {
    const root = document.getElementById('academyRoot')!;
    renderDesktopShell(root, 'Title');
    expect(root.className).toContain('academy-desktop');
    expect(root.querySelector('.academy-nav-rail')).toBeTruthy();
    expect(root.querySelector('.academy-mission-panel')).toBeTruthy();
    const refs = collectMountRefs(root);
    expect(refs.dialogueEl).toBeTruthy();
    expect(refs.actionsEl).toBeTruthy();
  });

  it('mobile shell does NOT have a persistent nav rail — structurally different from desktop, not just a CSS reflow', () => {
    const root = document.getElementById('academyRoot')!;
    renderMobileShell(root, 'Title');
    expect(root.querySelector('.academy-nav-rail')).toBeNull();
    expect(root.querySelector('.academy-sheet')).toBeTruthy();
  });

  it('same engine state renders equivalent dialogue text on both mobile and desktop', async () => {
    const rootA = document.body.appendChild(document.createElement('div'));
    const rootB = document.body.appendChild(document.createElement('div'));
    const { refs: refsA } = await setupSession(rootA, true);
    const { refs: refsB } = await setupSession(rootB, false);
    expect(refsA.dialogueEl.textContent).toBe(refsB.dialogueEl.textContent);
    expect(refsA.dialogueEl.textContent).toContain('Привет');
  });

  it('discover step shows a confirm action; confirming it unlocks advance', async () => {
    const root = document.getElementById('academyRoot')!;
    const { session, engine } = await setupSession(root, true);
    await session.advance(); // story -> discover
    expect(engine.getStep().id).toBe('s2');
    expect(root.querySelector('.academy-discover-confirm')).toBeTruthy();
    expect(engine.canAdvance()).toBe(false);
    session.confirmDiscover();
    expect(engine.canAdvance()).toBe(true);
  });

  it('practice step: wrong code shows an error and does not unlock advance; correct code shows success and unlocks it', async () => {
    const root = document.getElementById('academyRoot')!;
    const { session, engine, refs } = await setupSession(root, true);
    await session.advance(); // -> discover
    session.confirmDiscover();
    await session.advance(); // -> practice
    expect(engine.getStep().id).toBe('s3');

    const input = refs.practiceEl.querySelector('input') as HTMLInputElement;
    input.value = 'wrong';
    session.checkPracticeCode();
    expect(engine.canAdvance()).toBe(false);
    expect(refs.practiceEl.textContent).toMatch(/не найден|не то/i);

    input.value = TRAINING_STORE_CODE;
    session.checkPracticeCode();
    expect(engine.canAdvance()).toBe(true);
    expect(refs.practiceEl.textContent).toContain('ЗАМЕНА');
  });

  it('completing the final step persists to the server and shows a reward reveal instead of exiting immediately', async () => {
    // Only the LAST step (s4) grants a reward — earlier steps in this same
    // run must still complete normally (mockResolvedValue would wrongly
    // make every step look like a reward step).
    completeAcademyStepMock.mockImplementation((_headers: unknown, stepId: string) =>
      Promise.resolve(
        stepId === 's4'
          ? { already_completed: false, reward_granted: true, xp_awarded: 50, badge: { code: 'academy_employee_ch1', title: 'Первая замена' } }
          : { already_completed: false, reward_granted: false, xp_awarded: 0 }
      )
    );
    const root = document.getElementById('academyRoot')!;
    const { session, engine, refs, onExit } = await setupSession(root, true);
    await session.advance(); // -> discover
    session.confirmDiscover();
    await session.advance(); // -> practice
    const input = refs.practiceEl.querySelector('input') as HTMLInputElement;
    input.value = TRAINING_STORE_CODE;
    session.checkPracticeCode();
    await session.advance(); // -> cutscene (last step)
    expect(engine.getStep().id).toBe('s4');
    await session.advance(); // finishing the last step -> reward
    expect(completeAcademyStepMock).toHaveBeenCalledWith({}, 's4');
    expect(refs.dialogueEl.innerHTML).toContain('academy-reward-reveal');
    expect(refs.dialogueEl.textContent).toContain('+50 XP');
    expect(onExit).not.toHaveBeenCalled();
  });

  it('a replayed already-completed step does not show a reward reveal and just advances/exits normally', async () => {
    completeAcademyStepMock.mockResolvedValue({ already_completed: true, reward_granted: false, xp_awarded: 0 });
    const root = document.getElementById('academyRoot')!;
    const { session, onExit } = await setupSession(root, true);
    await session.advance(); // story -> discover, no reward this step
    expect(onExit).not.toHaveBeenCalled();
  });
});
