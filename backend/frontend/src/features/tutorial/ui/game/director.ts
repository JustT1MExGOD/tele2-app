import * as THREE from 'three';
import css from './game.css?inline';
import { Engine } from './render/engine.js';
import { buildShop } from './world/shop.js';
import { HumanoidRig, type PoseState } from './characters/humanoid.js';
import { ArbuzychRig } from './characters/arbuzych.js';
import { KeyboardInput } from './input/keyboard.js';
import { TouchInput } from './input/touch.js';
import { FollowCamera } from './camera/follow-camera.js';
import { InteractionSystem } from './interaction/interactables.js';
import { DialogueBox } from './dialogue/dialogue-box.js';
import { Hud } from './hud/hud.js';
import type { Interactable } from './types.js';
import type { AcademyStep, ArbuzichCue } from '../../model/types.js';

const instances = new WeakMap<HTMLElement, GameDirector>();
const read = (key: string) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };

const CUE_TO_POSE: Partial<Record<ArbuzichCue, PoseState>> = {
  idle: 'idle', waiting: 'idle', thinking: 'idle', hint: 'idle',
  talking: 'talk', explaining: 'talk', pointing: 'talk', surprised: 'talk',
  enter: 'wave', 'chapter-complete': 'wave',
  celebrating: 'success', success: 'success',
  mistake: 'mistake'
};

/** T2 Academy 3D episode — a third-person Three.js scene replacing the
 * earlier orthographic diorama prototype. Keeps the exact public contract
 * ui/shared/session.ts and academy-entry.ts already depend on
 * (mountGame/getGame/destroyGame + setStep/feedback/reward/destroy) so
 * NEITHER file needed to change for this pass — the episode logic below
 * only decides what an in-world interactable DOES; the actual step
 * completion rules still live entirely in session.ts (toggleShift/
 * beginSalePractice/runChecklistItem all independently re-validate the
 * current step server-authoritatively before doing anything, so a stray
 * interact press can never itself grant progress). See ART-DIRECTION.md
 * for the visual brief and PERFORMANCE.md for the measured budget.
 */
export class GameDirector {
  private world = document.createElement('div');
  private hudHost = document.createElement('div');
  private engine: Engine;
  private shop = buildShop();
  private player = new HumanoidRig({ skin: 0xe3b28c, outfit: 0x1f6f52, accent: 0x8fe61a });
  private arbuzych = new ArbuzychRig();
  private customer: HumanoidRig | null = null;
  private camera: FollowCamera;
  private keyboard: KeyboardInput;
  private touch: TouchInput;
  private interaction = new InteractionSystem();
  private dialogue: DialogueBox;
  private hud: Hud;
  private audio: AudioContext | null = null;
  private muted = !read('t2-academy-3d-sound');
  private controlLocked = true;
  private introSkip: HTMLButtonElement;
  private currentStep: AcademyStep | null = null;
  private disposed = false;
  private stopTick: () => void;
  private talkCooldown = 0;

  constructor(private root: HTMLElement) {
    if (!document.getElementById('academyGameStyles')) {
      const style = document.createElement('style');
      style.id = 'academyGameStyles';
      style.textContent = css;
      document.head.append(style);
    }
    root.classList.add('academy-game');
    root.dataset.mode = root.classList.contains('academy-journey') ? 'journey' : 'story';

    this.world.className = 'academy-3d-world';
    this.world.setAttribute('role', 'group');
    this.world.setAttribute('aria-label', 'Трёхмерный учебный магазин T2');
    root.prepend(this.world);
    this.hudHost.className = 'academy-3d-hud-layer';
    root.appendChild(this.hudHost);

    this.engine = new Engine(this.world);
    this.engine.scene.add(this.shop.group, this.player.root, this.arbuzych.root);
    this.player.root.position.copy(this.shop.anchors.playerSpawn);
    this.arbuzych.root.position.copy(this.shop.anchors.arbuzychSpot);
    this.arbuzych.root.rotation.y = Math.PI * 0.75;

    this.camera = new FollowCamera(this.shop.colliders);
    this.camera.snapBehind(this.player.root.position, Math.PI);

    this.keyboard = new KeyboardInput(this.world, { onEscape: () => window.__academyExit() });
    this.touch = new TouchInput(this.world, this.hudHost);

    this.dialogue = new DialogueBox(this.hudHost);
    this.hud = new Hud(this.hudHost);
    this.hud.quality = read('t2-academy-3d-low') ? 'low' : 'high';
    this.engine.setQuality(this.hud.quality);
    this.hud.onToggleQuality = () => this.engine.setQuality(this.hud.quality);
    this.hud.onToggleSound = () => { this.muted = this.hud.muted; if (!this.muted) this.unlockAudio(); };
    this.hud.onReveal = () => {
      const compact = root.classList.toggle('academy-game-compact');
      this.hud.setRevealLabel(compact);
    };

    this.introSkip = document.createElement('button');
    this.introSkip.type = 'button';
    this.introSkip.className = 'academy-3d-skip-intro';
    this.introSkip.textContent = 'Пропустить вступление';
    this.introSkip.hidden = true;
    this.introSkip.onclick = () => this.finishIntro();
    this.hudHost.appendChild(this.introSkip);

    this.setupInteractables();
    this.world.addEventListener('pointerdown', this.unlockAudio, { once: true });

    this.stopTick = this.engine.onTick(this.tick);
    this.engine.start();
    void this.playIntro();
  }

  private setupInteractables(): void {
    const marker = (pos: THREE.Vector3) => { const o = new THREE.Object3D(); o.position.copy(pos); return o; };
    const arbuzychMarker = marker(this.shop.anchors.arbuzychSpot);
    const terminalMarker = marker(this.shop.anchors.terminalSpot);
    const registerMarker = marker(this.shop.anchors.registerSpot);
    const exitMarker = marker(this.shop.anchors.entrance);

    this.interaction.register({
      id: 'arbuzych', object: arbuzychMarker, radius: 1.3, label: 'Поговорить с Арбузычем',
      enabled: () => true,
      onInteract: () => this.talkToArbuzych()
    });
    this.interaction.register({
      id: 'terminal', object: terminalMarker, radius: 1.1, label: 'Терминал смены',
      enabled: () => this.terminalRelevant(),
      onInteract: () => this.interactTerminal()
    });
    this.interaction.register({
      id: 'register', object: registerMarker, radius: 1.1, label: 'Учебная касса',
      enabled: () => this.registerRelevant(),
      onInteract: () => this.interactRegister()
    });
    this.interaction.register({
      id: 'exit', object: exitMarker, radius: 1.2, label: 'Выйти в приложение',
      enabled: () => true,
      onInteract: () => window.__academyExit()
    });
  }

  private terminalRelevant(): boolean {
    const step = this.currentStep;
    if (!step) return false;
    if (step.practiceKind === 'shift-open' || step.practiceKind === 'shift-close') return true;
    if (step.practiceKind === 'replacement' && step.kind === 'practice') return true;
    if (step.practiceKind === 'checklist') return !!step.checklist?.some((i) => i.kind === 'shift-open' || i.kind === 'shift-close');
    return false;
  }

  private registerRelevant(): boolean {
    const step = this.currentStep;
    if (!step) return false;
    if (step.practiceKind === 'sale') return true;
    if (step.practiceKind === 'checklist') return !!step.checklist?.some((i) => i.kind === 'sale');
    return false;
  }

  private interactTerminal(): void {
    const step = this.currentStep;
    if (!step) return;
    if (step.practiceKind === 'shift-open') window.__academyToggleShift('open');
    else if (step.practiceKind === 'shift-close') window.__academyToggleShift('close');
    else if (step.practiceKind === 'replacement') {
      this.root.querySelector<HTMLInputElement>('#academyPracticeCode')?.focus();
    } else if (step.practiceKind === 'checklist') {
      for (const item of step.checklist ?? []) {
        if (item.kind === 'shift-open' || item.kind === 'shift-close') window.__academyChecklistItem(item.id);
      }
    }
  }

  private interactRegister(): void {
    const step = this.currentStep;
    if (!step) return;
    if (step.practiceKind === 'sale') window.__academyBeginSale();
    else if (step.practiceKind === 'checklist') {
      for (const item of step.checklist ?? []) if (item.kind === 'sale') window.__academyChecklistItem(item.id);
    }
  }

  private talkToArbuzych(): void {
    if (this.talkCooldown > 0 || !this.currentStep?.say) return;
    this.talkCooldown = 1.2;
    this.arbuzych.setState('talk');
    this.player.setState('talk');
    this.playTone([392, 494]);
    void this.dialogue.say('Арбузыч', [this.currentStep.say]).then(() => {
      this.arbuzych.setState('idle');
      this.player.setState('idle');
    });
  }

  private async playIntro(): Promise<void> {
    this.introSkip.hidden = false;
    const path = this.shop.anchors.introPath;
    const total = 3.4;
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const step = () => {
        if (this.disposed || !this.controlLocked) { resolve(); return; }
        const t = Math.min(1, (performance.now() - start) / (total * 1000));
        const eased = t < 1 ? 1 - Math.pow(1 - t, 2) : 1;
        const segment = eased * (path.length - 1);
        const i = Math.min(path.length - 2, Math.floor(segment));
        const localT = segment - i;
        const pos = path[i].clone().lerp(path[i + 1], localT);
        this.engine.camera.position.copy(pos);
        this.engine.camera.lookAt(this.player.root.position.x, 0.9, this.player.root.position.z);
        if (t >= 1) { resolve(); return; }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    this.finishIntro();
  }

  private finishIntro(): void {
    if (!this.controlLocked) return;
    this.controlLocked = false;
    this.introSkip.hidden = true;
    this.camera.snapBehind(this.player.root.position, Math.PI);
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

  private tick = (dt: number): void => {
    this.talkCooldown = Math.max(0, this.talkCooldown - dt);
    const kb = this.keyboard.poll();
    const tc = this.touch.poll();
    const moveX = kb.moveX || tc.moveX;
    const moveZ = kb.moveZ || tc.moveZ;
    const lookDX = kb.lookDX + tc.lookDX;
    const lookDY = kb.lookDY + tc.lookDY;
    const interact = kb.interact || tc.interact;

    this.camera.applyLook(lookDX, lookDY);

    if (!this.controlLocked) {
      const speed = (kb.run ? 3.2 : 2.15);
      const mag = Math.min(1, Math.hypot(moveX, moveZ));
      if (mag > 0.02) {
        const forward = new THREE.Vector3(Math.sin(this.camera.yaw), 0, Math.cos(this.camera.yaw));
        const strafe = new THREE.Vector3(Math.cos(this.camera.yaw), 0, -Math.sin(this.camera.yaw));
        const move = forward.multiplyScalar(-moveZ).add(strafe.multiplyScalar(moveX));
        if (move.lengthSq() > 0.0001) {
          move.normalize().multiplyScalar(speed * dt * mag);
          const next = this.player.root.position.clone().add(move);
          this.resolveCollisions(next);
          this.player.root.position.copy(next);
          const targetYaw = Math.atan2(move.x, move.z);
          this.player.root.rotation.y = angleLerp(this.player.root.rotation.y, targetYaw, 1 - Math.pow(0.0001, dt));
        }
        if (this.player.state !== 'talk') this.player.setState('walk');
      } else if (this.player.state === 'walk') {
        this.player.setState('idle');
      }

      const hit = this.interaction.update(this.player.root.position);
      const desktop = matchMedia('(hover: hover) and (pointer: fine)').matches;
      this.hud.setInteractHint(hit?.label ?? null, desktop);
      this.touch.setInteractVisible(!!hit, hit?.label ?? '');
      if (interact) this.interaction.triggerCurrent();
    }

    this.player.update(dt, Math.min(1, Math.hypot(moveX, moveZ)));
    this.arbuzych.update(dt);
    this.customer?.update(dt, 0);
    this.camera.update(dt, this.engine.camera, this.player.root.position, this.player.root.position.y + 1.55);
  };

  private resolveCollisions(pos: THREE.Vector3): void {
    pos.x = Math.max(-5.1, Math.min(5.1, pos.x));
    pos.z = Math.max(-4.1, Math.min(4.55, pos.z));
    const p2 = new THREE.Vector2(pos.x, pos.z);
    for (const c of this.shop.colliders) {
      const d = p2.distanceTo(c.center);
      const min = c.radius + 0.28;
      if (d < min && d > 0.0001) {
        const push = p2.clone().sub(c.center).multiplyScalar((min - d) / d);
        p2.add(push);
      }
    }
    pos.x = p2.x; pos.z = p2.y;
  }

  private ensureCustomer(present: boolean): void {
    if (present && !this.customer) {
      this.customer = new HumanoidRig({ skin: 0xf0c9a0, outfit: 0x8a4b8f, accent: 0x2fd0e0 }, 1.58);
      this.customer.root.position.copy(this.shop.anchors.customerSpot);
      this.customer.root.rotation.y = Math.PI;
      this.engine.scene.add(this.customer.root);
    } else if (!present && this.customer) {
      this.engine.scene.remove(this.customer.root);
      this.customer.dispose();
      this.customer = null;
    }
  }

  setStep(step: AcademyStep, _index: number, _total: number): void {
    this.currentStep = step;
    this.hud.setObjective(objectiveLabel(step));
    this.hud.setRevealVisible(step.kind === 'discover');
    this.arbuzych.setState(CUE_TO_POSE[step.cue ?? 'idle'] ?? 'idle');
    this.ensureCustomer(this.registerRelevant());
    if (step.kind === 'story' || step.kind === 'cutscene') {
      this.player.setState('talk');
      setTimeout(() => { if (this.player.state === 'talk') this.player.setState('idle'); }, 1600);
    }
  }

  feedback(ok: boolean): void {
    this.arbuzych.setState(ok ? 'success' : 'mistake');
    this.player.setState(ok ? 'success' : 'mistake');
    this.playTone(ok ? [659, 880] : [220, 174]);
    setTimeout(() => {
      if (this.arbuzych.state !== 'talk') this.arbuzych.setState('idle');
      if (this.player.state !== 'talk') this.player.setState('idle');
    }, 900);
  }

  reward(): void {
    this.arbuzych.setState('success');
    this.player.setState('success');
    this.playTone([523, 659, 784, 1046]);
  }

  destroy(): void {
    this.disposed = true;
    this.stopTick();
    this.keyboard.destroy();
    this.touch.destroy();
    this.dialogue.destroy();
    this.hud.destroy();
    this.introSkip.remove();
    if (this.customer) { this.customer.dispose(); }
    this.player.dispose();
    this.arbuzych.dispose();
    void this.audio?.close().catch(() => {});
    this.engine.dispose();
    this.world.remove();
    this.hudHost.remove();
    this.root.classList.remove('academy-game', 'academy-game-low', 'academy-game-compact');
    delete this.root.dataset.mode;
  }
}

function angleLerp(from: number, to: number, t: number): number {
  let diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return from + diff * t;
}

function objectiveLabel(step: AcademyStep): string {
  switch (step.kind) {
    case 'discover': return 'Найди отмеченный элемент в приложении';
    case 'practice': return step.practiceKind === 'sale' ? 'Проведи учебную продажу на кассе' : step.practiceKind?.startsWith('shift-') ? 'Дойди до терминала смены' : 'Выполни задание';
    case 'challenge': return 'Пройди смену целиком: открой, продай, закрой';
    case 'quiz': return 'Ответь на вопрос';
    default: return 'Слушай Арбузыча';
  }
}

/** WebGL can genuinely be unavailable (old GPU/driver, headless/software
 * rendering with no context, a locked-down corporate browser). session.ts
 * already treats `this.game` as fully optional (`this.game?.xxx` at every
 * call site) so the correct fallback is simply: don't mount a game at all
 * — the existing 2D dialogue/practice/actions panel keeps working
 * unmodified, satisfying the brief's "облегчённый интерфейс" requirement
 * without a second bespoke fallback UI to maintain. */
export function mountGame(root: HTMLElement): GameDirector | undefined {
  destroyGame(root);
  const snapshotClass = root.className;
  const snapshotChildren = Array.from(root.children);
  try {
    const game = new GameDirector(root);
    instances.set(root, game);
    return game;
  } catch (error) {
    console.warn('T2 Academy: 3D game unavailable, falling back to the 2D panel.', error);
    for (const child of Array.from(root.children)) if (!snapshotChildren.includes(child)) child.remove();
    root.className = snapshotClass;
    return undefined;
  }
}
export function getGame(root: HTMLElement | null): GameDirector | undefined {
  return root ? instances.get(root) : undefined;
}
export function destroyGame(root: HTMLElement): void {
  instances.get(root)?.destroy();
  instances.delete(root);
}
