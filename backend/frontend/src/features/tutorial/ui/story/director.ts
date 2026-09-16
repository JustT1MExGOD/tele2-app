import { gsap } from 'gsap';
import css from './story.css?inline';
import { sceneForStep, idleJourneyScene, type SceneDescriptor } from './scenes.js';
import { arbuzychBodySvg, employeeFigureSvg, customerFigureSvg, sceneCelebration } from './illustrations.js';
import { arbuzichSvgMarkup } from '../../character/arbuzich-svg.js';
import { WipeTransition } from './transition.js';
import type { AcademyStep } from '../../model/types.js';

const instances = new WeakMap<HTMLElement, StoryDirector>();
const read = (key: string) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
const write = (key: string, value: boolean) => { try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* storage optional */ } };

function reduceMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** T2 Academy illustrated episode — a full-screen layered SVG "graphic
 * novel" scene replacing the earlier explorable 3D shop. Keeps the exact
 * public contract ui/shared/session.ts and academy-entry.ts already depend
 * on (mountGame/getGame/destroyGame + setStep/feedback/reward/destroy) so
 * neither file needed structural changes — this module only decides what
 * a step LOOKS like; completion rules still live entirely in session.ts.
 * See CLAUDE-ACADEMY-MOTION-BRIEF.md for the brief and ASSET-LICENSES.md
 * for the (entirely original, hand-authored) art assets. */
export class StoryDirector {
  private stage = document.createElement('div');
  private toolbar = document.createElement('div');
  private wipe: WipeTransition;
  private muted = !read('t2-academy-story-sound');
  private motionOff = read('t2-academy-story-motion-off');
  private audio: AudioContext | null = null;
  private disposed = false;
  private currentScene: SceneDescriptor = idleJourneyScene;

  constructor(private root: HTMLElement) {
    if (!document.getElementById('academyStoryStyles')) {
      const style = document.createElement('style');
      style.id = 'academyStoryStyles';
      style.textContent = css;
      document.head.append(style);
    }
    root.classList.add('academy-game');
    root.dataset.mode = root.classList.contains('academy-journey') ? 'journey' : 'story';

    this.stage.className = 'academy-3d-world story-stage';
    this.stage.setAttribute('role', 'img');
    this.stage.setAttribute('aria-label', 'Иллюстрация: сцена обучения T2 Академии');
    root.prepend(this.stage);

    this.wipe = new WipeTransition(this.stage);

    this.toolbar.className = 'academy-3d-toolbar story-toolbar';
    this.toolbar.innerHTML = `
      <button type="button" class="story-sound-toggle" aria-pressed="${!this.muted}">${this.muted ? '🔇 Звук' : '🔊 Звук'}</button>
      <button type="button" class="story-motion-toggle" aria-pressed="${this.motionOff}">${this.motionOff ? 'Анимация: выкл' : 'Анимация: вкл'}</button>`;
    this.toolbar.querySelector<HTMLButtonElement>('.story-sound-toggle')!.onclick = () => this.toggleSound();
    this.toolbar.querySelector<HTMLButtonElement>('.story-motion-toggle')!.onclick = () => this.toggleMotion();
    root.appendChild(this.toolbar);

    this.paintScene(idleJourneyScene, false);
    this.stage.addEventListener('pointerdown', this.unlockAudio, { once: true });
  }

  private effectiveReducedMotion(): boolean {
    return reduceMotion() || this.motionOff;
  }

  private toggleSound(): void {
    this.muted = !this.muted;
    write('t2-academy-story-sound', !this.muted);
    const btn = this.toolbar.querySelector<HTMLButtonElement>('.story-sound-toggle')!;
    btn.textContent = this.muted ? '🔇 Звук' : '🔊 Звук';
    btn.setAttribute('aria-pressed', String(!this.muted));
    if (!this.muted) this.unlockAudio();
  }

  private toggleMotion(): void {
    this.motionOff = !this.motionOff;
    write('t2-academy-story-motion-off', this.motionOff);
    const btn = this.toolbar.querySelector<HTMLButtonElement>('.story-motion-toggle')!;
    btn.textContent = this.motionOff ? 'Анимация: выкл' : 'Анимация: вкл';
    btn.setAttribute('aria-pressed', String(this.motionOff));
  }

  private unlockAudio = () => {
    if (this.muted) return;
    try { this.audio ||= new AudioContext(); void this.audio.resume().catch(() => {}); } catch { /* audio optional */ }
  };

  private playTone(notes: number[]): void {
    if (this.muted || this.audio?.state !== 'running') return;
    const ctx = this.audio;
    notes.forEach((frequency, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain(), time = ctx.currentTime + i * 0.09;
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.05, time + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.22);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(time); osc.stop(time + 0.24);
      osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    });
  }

  private paintScene(scene: SceneDescriptor, animateFigures: boolean): void {
    this.currentScene = scene;
    this.stage.innerHTML = scene.markup;

    const arbSlot = this.stage.querySelector<SVGGElement>('.story-figure-slot-arb');
    if (arbSlot) {
      // A nested <svg> establishes its own viewport and does NOT compose
      // cleanly with the ancestor <g> transforms here (position drifts far
      // from the body in every browser tested) — arbuzichSvgMarkup()'s
      // viewBox is already 1:1 with its own drawing units, so inlining its
      // contents as a plain <g> (no nested <svg>/viewBox) keeps it in the
      // same coordinate space as the translate/scale wrapper around it.
      const faceInner = arbuzichSvgMarkup().replace(/^\s*<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
      // academy-arbuzich carries the shared face part colors (styles.css
      // .academy-arbuzich .arb-*) that the reused arbuzichSvgMarkup() needs
      // — without it every part paints as default SVG black.
      arbSlot.innerHTML = `<g class="story-arb" transform="scale(0.85)">${arbuzychBodySvg()}<g class="story-arb-face academy-arbuzich" transform="translate(-16,-46) scale(0.5)">${faceInner}</g></g>`;
      arbSlot.classList.add('story-arb-pose', `story-pose-${scene.arbPose}`);
    }
    const empSlot = this.stage.querySelector<SVGGElement>('.story-figure-slot-employee');
    if (empSlot && scene.employee !== 'hidden') {
      empSlot.innerHTML = employeeFigureSvg(scene.employee === 'walk' ? 'walk' : 'idle');
    }
    if (scene.customer) {
      const customerHost = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      customerHost.setAttribute('transform', 'translate(760,420)');
      customerHost.innerHTML = customerFigureSvg();
      this.stage.querySelector('svg.story-scene-svg')?.appendChild(customerHost);
    }
    if (scene.id === 'celebration') this.burstConfetti();

    if (!animateFigures || this.effectiveReducedMotion()) return;
    const svg = this.stage.querySelector('svg.story-scene-svg');
    if (svg) gsap.fromTo(svg, { opacity: 0.4, y: 8 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' });
    if (arbSlot) gsap.fromTo(arbSlot, { scale: 0.9, transformOrigin: '50% 100%' }, { scale: 1, duration: 0.4, ease: 'back.out(1.6)' });
  }

  private burstConfetti(): void {
    if (this.effectiveReducedMotion()) return;
    const host = this.stage.querySelector<SVGGElement>('.story-confetti-slot');
    if (!host) return;
    const ns = 'http://www.w3.org/2000/svg';
    const colors = ['#7a5af8', '#2aabee', '#ffd966'];
    for (let i = 0; i < 18; i++) {
      const rect = document.createElementNS(ns, 'rect');
      const x = 200 + Math.random() * 560;
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', '-20');
      rect.setAttribute('width', '8');
      rect.setAttribute('height', '14');
      rect.setAttribute('fill', colors[i % colors.length]);
      host.appendChild(rect);
      gsap.to(rect, {
        y: 500 + Math.random() * 60,
        rotation: 180 + Math.random() * 360,
        duration: 1.4 + Math.random() * 0.8,
        delay: Math.random() * 0.3,
        ease: 'power1.in',
        onComplete: () => rect.remove()
      });
    }
  }

  setStep(step: AcademyStep, _index: number, _total: number): void {
    const scene = sceneForStep(step);
    const changed = scene.id !== this.currentScene.id || scene.employee !== this.currentScene.employee;
    if (!changed) {
      // Same backdrop, only the pose changed (e.g. talk -> success within
      // one scene) — swap the pose class without a full wipe transition.
      const arbSlot = this.stage.querySelector<SVGGElement>('.story-figure-slot-arb');
      if (arbSlot) {
        for (const cls of Array.from(arbSlot.classList)) if (cls.startsWith('story-pose-')) arbSlot.classList.remove(cls);
        arbSlot.classList.add(`story-pose-${scene.arbPose}`);
      }
      this.currentScene = scene;
      return;
    }
    void this.wipe.run(() => this.paintScene(scene, true));
  }

  feedback(ok: boolean): void {
    const arbSlot = this.stage.querySelector<SVGGElement>('.story-figure-slot-arb');
    this.playTone(ok ? [659, 880] : [220, 174]);
    if (!arbSlot || this.effectiveReducedMotion()) return;
    if (ok) gsap.fromTo(arbSlot, { scale: 1 }, { scale: 1.08, duration: 0.18, yoyo: true, repeat: 1, ease: 'power1.inOut' });
    else gsap.fromTo(arbSlot, { x: 0 }, { x: 6, duration: 0.07, yoyo: true, repeat: 5, ease: 'power1.inOut', onComplete: () => gsap.set(arbSlot, { x: 0 }) });
  }

  reward(): void {
    this.playTone([523, 659, 784, 1046]);
    const scene: SceneDescriptor = { id: 'celebration', markup: sceneCelebration(), employee: 'hidden', customer: false, arbPose: 'celebrate' };
    void this.wipe.run(() => this.paintScene(scene, true));
  }

  destroy(): void {
    this.disposed = true;
    gsap.killTweensOf(this.stage.querySelectorAll('*'));
    this.wipe.destroy();
    void this.audio?.close().catch(() => {});
    this.stage.remove();
    this.toolbar.remove();
    this.root.classList.remove('academy-game', 'academy-game-low', 'academy-game-compact');
    delete this.root.dataset.mode;
  }
}

/** A hard render failure here (e.g. no DOM SVG support) must not break the
 * rest of Academy — same fallback contract the previous 3D layer had:
 * mountGame() returning undefined simply means no illustrated backdrop,
 * the existing 2D dialogue/practice/actions panel keeps working unmodified. */
export function mountGame(root: HTMLElement): StoryDirector | undefined {
  destroyGame(root);
  const snapshotClass = root.className;
  const snapshotChildren = Array.from(root.children);
  try {
    const story = new StoryDirector(root);
    instances.set(root, story);
    return story;
  } catch (error) {
    console.warn('T2 Academy: illustrated story unavailable, falling back to the 2D panel.', error);
    for (const child of Array.from(root.children)) if (!snapshotChildren.includes(child)) child.remove();
    root.className = snapshotClass;
    return undefined;
  }
}
export function getGame(root: HTMLElement | null): StoryDirector | undefined {
  return root ? instances.get(root) : undefined;
}
export function destroyGame(root: HTMLElement): void {
  instances.get(root)?.destroy();
  instances.delete(root);
}
