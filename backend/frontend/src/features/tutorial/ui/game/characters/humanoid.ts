import * as THREE from 'three';

export type PoseState = 'idle' | 'walk' | 'talk' | 'wave' | 'success' | 'mistake' | 'sit';

export interface HumanoidColors {
  skin: number;
  outfit: number;
  accent: number;
}

/** A lightweight procedural "puppet" rig: no imported skeleton/animation
 * clips (no external rigging pipeline is available in this pass — see
 * ART-DIRECTION.md's honest limitations note), but a real named joint
 * hierarchy driven by hand-authored per-joint sine curves per PoseState,
 * not a static prop. Proportions/silhouette are tuned for readability at
 * third-person distance, matching the brand's rounded, friendly language. */
export class HumanoidRig {
  readonly root = new THREE.Group();
  private hips = new THREE.Group();
  private spine = new THREE.Group();
  private chest = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private foreArmL = new THREE.Group();
  private foreArmR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private shinL = new THREE.Group();
  private shinR = new THREE.Group();
  private t = Math.random() * 10;
  state: PoseState = 'idle';
  private stateT = 0;
  private oneShotDone = false;
  private height: number;

  constructor(colors: HumanoidColors, height = 1.62) {
    this.height = height;
    const skinMat = new THREE.MeshStandardMaterial({ color: colors.skin, roughness: 0.55 });
    const outfitMat = new THREE.MeshStandardMaterial({ color: colors.outfit, roughness: 0.6 });
    const accentMat = new THREE.MeshStandardMaterial({ color: colors.accent, emissive: colors.accent, emissiveIntensity: 0.35, roughness: 0.4 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x11151a, roughness: 0.3 });

    const capsule = (radius: number, length: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 8), mat);
      m.castShadow = true; m.receiveShadow = true;
      return m;
    };

    this.root.add(this.hips);
    this.hips.position.y = height * 0.52;
    this.hips.add(capsule(height * 0.11, height * 0.14, outfitMat));

    this.hips.add(this.legL, this.legR);
    for (const [leg, shin, side] of [[this.legL, this.shinL, -1], [this.legR, this.shinR, 1]] as const) {
      leg.position.set(side * height * 0.09, -height * 0.02, 0);
      const thigh = capsule(height * 0.065, height * 0.24, outfitMat);
      thigh.position.y = -height * 0.15;
      leg.add(thigh, shin);
      shin.position.y = -height * 0.29;
      const shinMesh = capsule(height * 0.055, height * 0.24, skinMat);
      shinMesh.position.y = -height * 0.13;
      shin.add(shinMesh);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(height * 0.07, height * 0.045, height * 0.16), outfitMat);
      foot.position.set(0, -height * 0.27, height * 0.045);
      foot.castShadow = true;
      shin.add(foot);
    }

    this.hips.add(this.spine);
    this.spine.position.y = height * 0.16;
    this.spine.add(this.chest);
    this.chest.add(capsule(height * 0.14, height * 0.22, outfitMat));
    const collar = new THREE.Mesh(new THREE.TorusGeometry(height * 0.135, height * 0.02, 6, 12), accentMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = height * 0.13;
    this.chest.add(collar);

    this.chest.add(this.head);
    this.head.position.y = height * 0.22;
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(height * 0.115, 14, 12), skinMat);
    headMesh.castShadow = true;
    this.head.add(headMesh);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(height * 0.118, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), new THREE.MeshStandardMaterial({ color: 0x24201d, roughness: 0.5 }));
    hair.position.y = height * 0.02;
    this.head.add(hair);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(height * 0.014, 8, 8), eyeMat);
      eye.position.set(side * height * 0.045, height * 0.01, height * 0.105);
      this.head.add(eye);
    }

    this.chest.add(this.armL, this.armR);
    for (const [arm, fore, side] of [[this.armL, this.foreArmL, -1], [this.armR, this.foreArmR, 1]] as const) {
      arm.position.set(side * height * 0.17, height * 0.17, 0);
      const upper = capsule(height * 0.05, height * 0.2, outfitMat);
      upper.position.y = -height * 0.11;
      arm.add(upper, fore);
      fore.position.y = -height * 0.22;
      const foreMesh = capsule(height * 0.042, height * 0.18, skinMat);
      foreMesh.position.y = -height * 0.1;
      fore.add(foreMesh);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(height * 0.048, 8, 8), skinMat);
      hand.position.y = -height * 0.2;
      fore.add(hand);
    }
  }

  setState(state: PoseState): void {
    if (state === this.state) return;
    this.state = state;
    this.stateT = 0;
    this.oneShotDone = false;
  }

  /** speed: 0..1, current locomotion speed fraction (drives stride length/rate). */
  update(dt: number, speed = 0): void {
    this.t += dt;
    this.stateT += dt;
    const idleBob = Math.sin(this.t * 1.6) * 0.012;
    this.chest.position.y = 0.16 * this.height + idleBob;
    this.head.rotation.y = Math.sin(this.t * 0.5) * 0.06;

    if (this.state === 'walk' && speed > 0.02) {
      const stride = 6 + speed * 4;
      const phase = this.t * stride;
      const swing = 0.55 * Math.min(1, speed * 1.3 + 0.3);
      this.legL.rotation.x = Math.sin(phase) * swing;
      this.legR.rotation.x = Math.sin(phase + Math.PI) * swing;
      this.shinL.rotation.x = Math.max(0, -Math.sin(phase + 0.5)) * 0.9;
      this.shinR.rotation.x = Math.max(0, -Math.sin(phase + Math.PI + 0.5)) * 0.9;
      this.armL.rotation.x = Math.sin(phase + Math.PI) * swing * 0.7;
      this.armR.rotation.x = Math.sin(phase) * swing * 0.7;
      this.hips.position.y = this.height * 0.52 + Math.abs(Math.sin(phase)) * 0.02;
      this.root.rotation.z = Math.sin(phase) * 0.02;
    } else {
      const settle = Math.min(1, dt * 8);
      this.legL.rotation.x *= 1 - settle; this.legR.rotation.x *= 1 - settle;
      this.shinL.rotation.x *= 1 - settle; this.shinR.rotation.x *= 1 - settle;
      this.hips.position.y += (this.height * 0.52 - this.hips.position.y) * settle;
      this.root.rotation.z *= 1 - settle;

      if (this.state === 'talk') {
        this.armR.rotation.x = -0.5 + Math.sin(this.t * 3) * 0.15;
        this.armR.rotation.z = -0.3;
        this.head.rotation.x = Math.sin(this.t * 2) * 0.05;
        this.armL.rotation.x += (0 - this.armL.rotation.x) * settle;
      } else if (this.state === 'wave') {
        this.armR.rotation.z = -2.2 + Math.sin(this.t * 6) * 0.35;
        this.armR.rotation.x = -0.2;
        this.armL.rotation.x += (0 - this.armL.rotation.x) * settle;
      } else if (this.state === 'success') {
        const p = Math.min(1, this.stateT * 2);
        this.armL.rotation.z = 2.0 * p; this.armR.rotation.z = -2.0 * p;
        this.root.position.y = Math.abs(Math.sin(this.stateT * 8)) * 0.06 * (1 - Math.min(1, this.stateT));
      } else if (this.state === 'mistake') {
        this.head.rotation.z = Math.sin(this.stateT * 18) * 0.08 * Math.max(0, 1 - this.stateT * 2);
        this.armL.rotation.x += (0 - this.armL.rotation.x) * settle;
        this.armR.rotation.x += (0 - this.armR.rotation.x) * settle;
      } else {
        this.armL.rotation.x += (0 - this.armL.rotation.x) * settle;
        this.armR.rotation.x += (0 - this.armR.rotation.x) * settle;
        this.armR.rotation.z += (0 - this.armR.rotation.z) * settle;
        this.armL.rotation.z += (0 - this.armL.rotation.z) * settle;
        this.head.rotation.x += (0 - this.head.rotation.x) * settle;
        this.head.rotation.z += (0 - this.head.rotation.z) * settle;
        this.root.position.y += (0 - this.root.position.y) * settle;
      }
    }
  }

  dispose(): void {
    this.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose()); else mat?.dispose();
    });
  }
}
