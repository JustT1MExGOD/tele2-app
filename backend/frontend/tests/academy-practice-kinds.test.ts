/**
 * T2 Academy — practiceKind variants (sale/shift-open/shift-close/
 * checklist) added in Phase 2. Includes a dedicated regression test for a
 * real re-entrancy bug caught during development: auto-completing a
 * shift-open/close step from pre-existing sandbox state inside render()
 * recursed infinitely (markRequiredActionDone()'s emit re-entered render()
 * before the step-id guard was updated).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const completeAcademyStepMock = vi.fn().mockResolvedValue({ already_completed: false, reward_granted: false, xp_awarded: 0 });
const getAcademyProgressMock = vi.fn().mockResolvedValue({ completed_step_ids: [], xp_total: 0, badges: [] });

vi.mock('../src/features/tutorial/api.js', () => ({
  getAcademyProgress: (...args: any[]) => getAcademyProgressMock(...args),
  completeAcademyStep: (...args: any[]) => completeAcademyStepMock(...args)
}));

import { TutorialEngine } from '../src/features/tutorial/engine/tutorial-engine.js';
import { ArbuzichController } from '../src/features/tutorial/character/arbuzich-controller.js';
import { AcademySession, collectMountRefs } from '../src/features/tutorial/ui/shared/session.js';
import { renderMobileShell } from '../src/features/tutorial/ui/mobile/present.js';
import { TRAINING_STORE_CODE } from '../src/features/tutorial/practice/replacement-practice.js';
import type { AcademyCourse } from '../src/features/tutorial/model/types.js';

function makeCourse(): AcademyCourse {
  return {
    id: 'test', role: 'employee', title: 'Test',
    chapters: [{
      id: 'ch', title: 'Chapter',
      steps: [
        { id: 'open1', kind: 'practice', practiceKind: 'shift-open' },
        { id: 'sale1', kind: 'practice', practiceKind: 'sale', saleTarget: { sim: 1, mnp: 1 } },
        { id: 'close1', kind: 'practice', practiceKind: 'shift-close' },
        {
          id: 'final', kind: 'challenge', practiceKind: 'checklist',
          checklist: [
            { id: 'c1', label: 'Открой смену', kind: 'shift-open' },
            { id: 'c2', label: 'Закрой смену', kind: 'shift-close' }
          ]
        }
      ]
    }]
  };
}

async function setup() {
  const root = document.body.appendChild(document.createElement('div'));
  renderMobileShell(root, 'Chapter');
  const refs = collectMountRefs(root);
  const engine = new TutorialEngine(makeCourse());
  const arbuzich = new ArbuzichController();
  const onExit = vi.fn();
  const session = new AcademySession(engine, arbuzich, {}, refs, onExit);
  session.start();
  return { session, engine, refs, onExit, root };
}

describe('T2 Academy practiceKind variants (Phase 2)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.stubGlobal('__academyAdvance', vi.fn());
    vi.stubGlobal('__academyExit', vi.fn());
    vi.stubGlobal('__academyBeginSale', vi.fn());
    vi.stubGlobal('__academyToggleShift', vi.fn());
    vi.stubGlobal('__academyChecklistItem', vi.fn());
  });

  it('shift-open: renders an open button; clicking it unlocks advance and shows confirmation', async () => {
    const { session, engine, refs } = await setup();
    expect(engine.getStep().id).toBe('open1');
    expect(refs.practiceEl.textContent).toContain('Открыть смену');
    expect(engine.canAdvance()).toBe(false);
    session.toggleShift('open');
    expect(engine.canAdvance()).toBe(true);
    expect(refs.practiceEl.textContent).toContain('Смена открыта');
  });

  it('regression: a shift-open step does NOT infinite-recurse when the sandbox was already left open by an earlier step in the same session', async () => {
    const { session, engine, refs } = await setup();
    session.toggleShift('open'); // opens it during step "open1"
    await session.advance(); // -> sale1
    // Rewind the engine back to a FRESH shift-open step while the shared
    // sandbox is still "open" from before — jumpToStep() itself emits,
    // which is what re-enters AcademySession's subscribed render(). This
    // exact stale-state combination is what recursed infinitely before the
    // fix (only reachable via a real course that revisits shift-open
    // later, e.g. the final challenge; reproduced directly here for a
    // fast, deterministic regression test — a stack overflow would fail
    // this test by crashing it, not via a normal assertion).
    expect(() => engine.jumpToStep('open1')).not.toThrow();
    expect(refs.practiceEl.textContent).toContain('Открыть смену');
    expect(engine.canAdvance()).toBe(false);
  });

  it('sale: opens the real sale form via __academyBeginSale flow and unlocks advance on a matching submission', async () => {
    vi.stubGlobal('openAddSale', vi.fn());
    const { session, engine } = await setup();
    session.toggleShift('open');
    await session.advance(); // -> sale1
    expect(engine.getStep().id).toBe('sale1');
    expect(engine.canAdvance()).toBe(false);
    const promise = session.beginSalePractice();
    window.__tutorialDryRunCallback?.({ sim: 1, mnp: 1 });
    await promise;
    expect(engine.canAdvance()).toBe(true);
  });

  it('sale: a non-matching submission does not unlock advance', async () => {
    vi.stubGlobal('openAddSale', vi.fn());
    const { session, engine } = await setup();
    session.toggleShift('open');
    await session.advance();
    const promise = session.beginSalePractice();
    window.__tutorialDryRunCallback?.({ sim: 5 });
    await promise;
    expect(engine.canAdvance()).toBe(false);
  });

  it('checklist: requires EVERY item done before unlocking advance, not just one', async () => {
    const { session, engine } = await setup();
    session.toggleShift('open');
    await session.advance(); // sale1
    const promiseSale = session.beginSalePractice();
    window.__tutorialDryRunCallback?.({ sim: 1, mnp: 1 });
    await promiseSale;
    await session.advance(); // close1
    session.toggleShift('close');
    await session.advance(); // final (checklist)
    expect(engine.getStep().id).toBe('final');
    expect(engine.canAdvance()).toBe(false);

    await session.runChecklistItem('c1'); // open
    expect(engine.canAdvance()).toBe(false); // still one left

    await session.runChecklistItem('c2'); // close
    expect(engine.canAdvance()).toBe(true);
  });

  it('checklist: an unknown item id is a no-op, never marks anything done', async () => {
    const { session, engine } = await setup();
    session.toggleShift('open');
    await session.advance();
    const promiseSale = session.beginSalePractice();
    window.__tutorialDryRunCallback?.({ sim: 1, mnp: 1 });
    await promiseSale;
    await session.advance();
    session.toggleShift('close');
    await session.advance(); // final
    await session.runChecklistItem('does-not-exist');
    expect(engine.canAdvance()).toBe(false);
  });

  it('a step with no practiceKind still defaults to the original replacement code-entry UI', async () => {
    const course: AcademyCourse = {
      id: 't', role: 'employee', title: 'T',
      chapters: [{ id: 'c', title: 'C', steps: [{ id: 's1', kind: 'practice' }] }]
    };
    const root = document.body.appendChild(document.createElement('div'));
    renderMobileShell(root, 'C');
    const refs = collectMountRefs(root);
    const engine = new TutorialEngine(course);
    const session = new AcademySession(engine, new ArbuzichController(), {}, refs, vi.fn());
    session.start();
    expect(refs.practiceEl.querySelector('#academyPracticeCode')).toBeTruthy();
    session.checkPracticeCode(); // no input value yet
    const input = refs.practiceEl.querySelector('input') as HTMLInputElement;
    input.value = TRAINING_STORE_CODE;
    session.checkPracticeCode();
    expect(engine.canAdvance()).toBe(true);
  });
});
