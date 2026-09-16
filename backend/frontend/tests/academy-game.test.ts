import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock('../src/features/tutorial/api.js', () => ({ completeAcademyStep: api.complete, getAcademyProgress: vi.fn() }));
import { TutorialEngine } from '../src/features/tutorial/engine/tutorial-engine.js';
import { ArbuzichController } from '../src/features/tutorial/character/arbuzich-controller.js';
import { AcademySession, collectMountRefs } from '../src/features/tutorial/ui/shared/session.js';
import { renderMobileShell } from '../src/features/tutorial/ui/mobile/present.js';
import { mountGame, getGame, destroyGame } from '../src/features/tutorial/ui/story/director.js';
import { sceneForStep } from '../src/features/tutorial/ui/story/scenes.js';
import { openTrainingSale } from '../src/features/tutorial/ui/shared/training-sale.js';
import type { AcademyStep } from '../src/features/tutorial/model/types.js';
let session: AcademySession | undefined;
const response = { already_completed: false, reward_granted: false, xp_awarded: 0 };
beforeEach(() => { document.body.innerHTML = ''; api.complete.mockReset().mockResolvedValue(response); });
afterEach(() => { session?.destroy(); session = undefined; });
function setup(steps: AcademyStep[]) {
  const root = document.createElement('div'); document.body.append(root); renderMobileShell(root, 'Миссия');
  const engine = new TutorialEngine({ id: 'test', title: 'Тест', role: 'employee', chapters: [{ id: 'ch', title: 'Глава', steps }] });
  session = new AcademySession(engine, new ArbuzichController(), {}, collectMountRefs(root), vi.fn()); session.start(); return { root, engine, session };
}
it('монтирует иллюстрированную сцену без исключений и её можно демонтировать', () => {
  const root = document.createElement('div'); document.body.append(root);
  const before = root.className;
  const story = mountGame(root);
  expect(story).toBeDefined();
  expect(getGame(root)).toBe(story);
  expect(root.querySelector('.story-stage svg.story-scene-svg')).toBeTruthy();
  destroyGame(root);
  expect(getGame(root)).toBeUndefined();
  expect(root.className).toBe(before);
  destroyGame(root); // must be a safe no-op when nothing was mounted
});
it('перерисовывает сцену при смене шага и не падает на feedback/reward', () => {
  const root = document.createElement('div'); document.body.append(root);
  const story = mountGame(root)!;
  const step: AcademyStep = { id: 'employee-ch1-welcome', kind: 'cutscene', cue: 'enter' };
  expect(() => story.setStep(step, 0, 1)).not.toThrow();
  expect(() => story.feedback(true)).not.toThrow();
  expect(() => story.feedback(false)).not.toThrow();
  expect(() => story.reward()).not.toThrow();
  destroyGame(root);
});
it('для каждого известного вида шага подбирается сцена, включая непортированные главы', () => {
  const kinds: AcademyStep['kind'][] = ['story', 'discover', 'practice', 'challenge', 'quiz', 'cutscene'];
  for (const kind of kinds) {
    const scene = sceneForStep({ id: 'unmapped-step', kind });
    expect(scene.markup).toContain('story-scene-svg');
  }
});
it('не сохраняет незавершённую практику', async () => { const { session } = setup([{ id: 'a', kind: 'practice' }]); await session.advance(); expect(api.complete).not.toHaveBeenCalled(); });
it('объединяет двойное нажатие в один переход', async () => { let resolve!: (value: unknown) => void; api.complete.mockImplementation(() => new Promise(r => { resolve = r; })); const { session, engine } = setup([{ id: 'a', kind: 'story' }, { id: 'b', kind: 'story' }, { id: 'c', kind: 'story' }]); const first = session.advance(); await session.advance(); expect(api.complete).toHaveBeenCalledOnce(); resolve(response); await first; expect(engine.getStep().id).toBe('b'); });
it('позволяет повторить сохранение после ошибки сети', async () => { api.complete.mockRejectedValueOnce(new Error('offline')); const { session, engine, root } = setup([{ id: 'a', kind: 'story' }, { id: 'b', kind: 'story' }]); await session.advance(); expect(engine.getStep().id).toBe('a'); expect(root.querySelector('[role=alert]')).toBeTruthy(); await session.advance(); expect(engine.getStep().id).toBe('b'); });
it('не меняет закрытую сессию после ответа сервера', async () => { let resolve!: (value: unknown) => void; api.complete.mockImplementation(() => new Promise(r => { resolve = r; })); const { session, engine } = setup([{ id: 'a', kind: 'story' }, { id: 'b', kind: 'story' }]); const pending = session.advance(); session.destroy(); resolve(response); await pending; expect(engine.getStep().id).toBe('a'); });
it('проверяет ответы реальными кнопками', () => { const { root, engine } = setup([{ id: 'a', kind: 'quiz', quiz: { question: 'Выбери', options: ['Нет', 'Да'], correctIndex: 1 } }]); const buttons = root.querySelectorAll<HTMLButtonElement>('.academy-quiz button'); buttons[0].click(); expect(engine.canAdvance()).toBe(false); buttons[1].click(); expect(engine.canAdvance()).toBe(true); });
it('не разрешает закрыть смену до открытия в финальном задании', async () => { const { session, engine, root } = setup([{ id: 'a', kind: 'challenge', practiceKind: 'checklist', checklist: [{ id: 'open', kind: 'shift-open', label: 'Открыть' }, { id: 'close', kind: 'shift-close', label: 'Закрыть' }] }]); await session.runChecklistItem('close'); expect(root.querySelector('.done')).toBeNull(); await session.runChecklistItem('open'); expect(engine.canAdvance()).toBe(false); await session.runChecklistItem('close'); expect(engine.canAdvance()).toBe(true); });
it('касса требует точное количество и отменяется при закрытии', async () => { const root = document.createElement('div'), abort = new AbortController(); document.body.append(root); const pending = openTrainingSale(root, { sim: 1 }, abort.signal); const form = root.querySelector('form')!, input = root.querySelector('input')!; input.value = '2'; form.dispatchEvent(new Event('submit', { cancelable: true })); expect(root.querySelector('[role=status]')?.textContent).toContain('Проверь'); abort.abort(); expect(await pending).toEqual({ matched: false, cancelled: true }); expect(root.children.length).toBe(0); });
