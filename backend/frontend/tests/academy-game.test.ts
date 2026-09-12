import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock('../src/features/tutorial/api.js', () => ({ completeAcademyStep: api.complete, getAcademyProgress: vi.fn() }));
import * as THREE from 'three';
import { TutorialEngine } from '../src/features/tutorial/engine/tutorial-engine.js';
import { ArbuzichController } from '../src/features/tutorial/character/arbuzich-controller.js';
import { AcademySession, collectMountRefs } from '../src/features/tutorial/ui/shared/session.js';
import { renderMobileShell } from '../src/features/tutorial/ui/mobile/present.js';
import { mountGame, getGame, destroyGame } from '../src/features/tutorial/ui/game/director.js';
import { InteractionSystem } from '../src/features/tutorial/ui/game/interaction/interactables.js';
import { buildShop } from '../src/features/tutorial/ui/game/world/shop.js';
import { openTrainingSale } from '../src/features/tutorial/ui/game/training-sale.js';
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
it('находит ближайший доступный интерактивный объект в радиусе', () => {
  const system = new InteractionSystem();
  const near = new THREE.Object3D(); near.position.set(1, 0, 0);
  const far = new THREE.Object3D(); far.position.set(5, 0, 0);
  const onInteract = vi.fn();
  system.register({ id: 'terminal', object: far, radius: 1.5, label: 'Далеко', enabled: () => true, onInteract: vi.fn() });
  system.register({ id: 'register', object: near, radius: 1.5, label: 'Рядом', enabled: () => true, onInteract });
  const hit = system.update(new THREE.Vector3(0, 0, 0));
  expect(hit?.id).toBe('register');
  system.triggerCurrent();
  expect(onInteract).toHaveBeenCalledOnce();
});
it('игнорирует отключённый интерактивный объект даже в радиусе', () => {
  const system = new InteractionSystem();
  const obj = new THREE.Object3D();
  system.register({ id: 'register', object: obj, radius: 2, label: 'X', enabled: () => false, onInteract: vi.fn() });
  expect(system.update(new THREE.Vector3(0, 0, 0))).toBeNull();
});
it('строит магазин с непересекающимися координатами точек интереса внутри пола', () => {
  const shop = buildShop();
  const spots = [shop.anchors.arbuzychSpot, shop.anchors.terminalSpot, shop.anchors.registerSpot, shop.anchors.playerSpawn];
  for (const spot of spots) { expect(Math.abs(spot.x)).toBeLessThan(5.5); expect(Math.abs(spot.z)).toBeLessThan(4.5); }
  expect(shop.colliders.length).toBeGreaterThan(0);
  expect(shop.anchors.introPath.length).toBeGreaterThan(1);
});
it('без доступного WebGL-контекста не монтирует игру и не оставляет сломанный DOM — 2D-панель остаётся рабочей', () => {
  const root = document.createElement('div'); document.body.append(root);
  const before = root.className;
  const game = mountGame(root); // jsdom has no real WebGL context, so this exercises the fallback path
  expect(game).toBeUndefined();
  expect(getGame(root)).toBeUndefined();
  expect(root.className).toBe(before);
  destroyGame(root); // must be a safe no-op when nothing was mounted
});
it('не сохраняет незавершённую практику', async () => { const { session } = setup([{ id: 'a', kind: 'practice' }]); await session.advance(); expect(api.complete).not.toHaveBeenCalled(); });
it('объединяет двойное нажатие в один переход', async () => { let resolve!: (value: unknown) => void; api.complete.mockImplementation(() => new Promise(r => { resolve = r; })); const { session, engine } = setup([{ id: 'a', kind: 'story' }, { id: 'b', kind: 'story' }, { id: 'c', kind: 'story' }]); const first = session.advance(); await session.advance(); expect(api.complete).toHaveBeenCalledOnce(); resolve(response); await first; expect(engine.getStep().id).toBe('b'); });
it('позволяет повторить сохранение после ошибки сети', async () => { api.complete.mockRejectedValueOnce(new Error('offline')); const { session, engine, root } = setup([{ id: 'a', kind: 'story' }, { id: 'b', kind: 'story' }]); await session.advance(); expect(engine.getStep().id).toBe('a'); expect(root.querySelector('[role=alert]')).toBeTruthy(); await session.advance(); expect(engine.getStep().id).toBe('b'); });
it('не меняет закрытую сессию после ответа сервера', async () => { let resolve!: (value: unknown) => void; api.complete.mockImplementation(() => new Promise(r => { resolve = r; })); const { session, engine } = setup([{ id: 'a', kind: 'story' }, { id: 'b', kind: 'story' }]); const pending = session.advance(); session.destroy(); resolve(response); await pending; expect(engine.getStep().id).toBe('a'); });
it('проверяет ответы реальными кнопками', () => { const { root, engine } = setup([{ id: 'a', kind: 'quiz', quiz: { question: 'Выбери', options: ['Нет', 'Да'], correctIndex: 1 } }]); const buttons = root.querySelectorAll<HTMLButtonElement>('.academy-quiz button'); buttons[0].click(); expect(engine.canAdvance()).toBe(false); buttons[1].click(); expect(engine.canAdvance()).toBe(true); });
it('не разрешает закрыть смену до открытия в финальном задании', async () => { const { session, engine, root } = setup([{ id: 'a', kind: 'challenge', practiceKind: 'checklist', checklist: [{ id: 'open', kind: 'shift-open', label: 'Открыть' }, { id: 'close', kind: 'shift-close', label: 'Закрыть' }] }]); await session.runChecklistItem('close'); expect(root.querySelector('.done')).toBeNull(); await session.runChecklistItem('open'); expect(engine.canAdvance()).toBe(false); await session.runChecklistItem('close'); expect(engine.canAdvance()).toBe(true); });
it('касса требует точное количество и отменяется при закрытии', async () => { const root = document.createElement('div'), abort = new AbortController(); document.body.append(root); const pending = openTrainingSale(root, { sim: 1 }, abort.signal); const form = root.querySelector('form')!, input = root.querySelector('input')!; input.value = '2'; form.dispatchEvent(new Event('submit', { cancelable: true })); expect(root.querySelector('[role=status]')?.textContent).toContain('Проверь'); abort.abort(); expect(await pending).toEqual({ matched: false, cancelled: true }); expect(root.children.length).toBe(0); });
