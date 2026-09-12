import * as THREE from 'three';
import type { PoseState } from './humanoid.js';

/** Арбузыч — the brand mascot: a round watermelon-green body, big
 * expressive eyes, short limbs. A distinct silhouette from the human
 * characters on purpose (keeps the brand character instantly readable
 * next to a realistic-proportioned player/customer). */
export class ArbuzychRig {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private mouth: THREE.Mesh;
  private t = 0;
  state: PoseState = 'idle';
  private stateT = 0;

  constructor() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3fa62a, roughness: 0.45 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0x1f5f1a, roughness: 0.5 });
    const bellyMat = new THREE.MeshStandardMaterial({ color: 0xf2e6b8, roughness: 0.6 });
    const limbMat = new THREE.MeshStandardMaterial({ color: 0x2f7a22, roughness: 0.55 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf5f7ee, roughness: 0.2 });
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x141a12, roughness: 0.2 });

    this.root.add(this.body);
    this.body.position.y = 0.36;
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 16), bodyMat);
    torso.scale.set(1, 1.08, 1);
    torso.castShadow = true; torso.receiveShadow = true;
    this.body.add(torso);
    for (let i = -1; i <= 1; i++) {
      const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.025, 6, 20, Math.PI * 1.15), stripeMat);
      stripe.rotation.set(Math.PI / 2, 0, i * 1.05);
      stripe.position.y = 0.02;
      this.body.add(stripe);
    }
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), bellyMat);
    belly.position.set(0, -0.04, 0.2);
    belly.scale.set(0.9, 0.85, 0.55);
    this.body.add(belly);

    this.body.add(this.head);
    this.head.position.y = 0.46;
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.27, 18, 14), bodyMat);
    headMesh.castShadow = true;
    this.head.add(headMesh);
    for (const side of [-1, 1]) {
      const eyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), whiteMat);
      eyeWhite.position.set(side * 0.115, 0.02, 0.225);
      this.head.add(eyeWhite);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 8), pupilMat);
      pupil.position.set(side * 0.115, 0.02, 0.29);
      this.head.add(pupil);
    }
    this.mouth = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.016, 6, 12, Math.PI), pupilMat);
    this.mouth.position.set(0, -0.11, 0.24);
    this.mouth.rotation.set(0, 0, Math.PI);
    this.head.add(this.mouth);
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 6), new THREE.MeshStandardMaterial({ color: 0x2f7a22, roughness: 0.6 }));
    leaf.position.set(0.05, 0.33, 0);
    leaf.rotation.z = -0.3;
    this.head.add(leaf);

    this.body.add(this.armL, this.armR);
    for (const [arm, side] of [[this.armL, -1], [this.armR, 1]] as const) {
      arm.position.set(side * 0.32, 0.06, 0.02);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.16, 4, 8), limbMat);
      upper.rotation.z = side * 0.5;
      upper.position.set(side * 0.06, -0.06, 0);
      upper.castShadow = true;
      arm.add(upper);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), bodyMat);
      hand.position.set(side * 0.12, -0.18, 0);
      arm.add(hand);
    }

    this.root.add(this.legL, this.legR);
    for (const [leg, side] of [[this.legL, -1], [this.legR, 1]] as const) {
      leg.position.set(side * 0.13, 0.1, 0);
      const foot = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.05, 4, 8), whiteMat);
      foot.rotation.z = Math.PI / 2;
      foot.position.set(0, 0, 0.03);
      foot.castShadow = true;
      leg.add(foot);
    }
  }

  setState(state: PoseState): void {
    if (state === this.state) return;
    this.state = state;
    this.stateT = 0;
  }

  update(dt: number): void {
    this.t += dt;
    this.stateT += dt;
    const bob = Math.sin(this.t * 2.1) * 0.02;
    this.body.position.y = 0.36 + bob;
    this.root.rotation.y = Math.sin(this.t * 0.35) * 0.08;

    const settle = Math.min(1, dt * 8);
    if (this.state === 'talk' || this.state === 'idle') {
      const talk = this.state === 'talk';
      this.mouth.scale.y = talk ? 1 + Math.abs(Math.sin(this.t * 9)) * 1.6 : 1;
      this.armR.rotation.z += ((talk ? -0.4 : 0) - this.armR.rotation.z) * settle;
    } else if (this.state === 'wave') {
      this.armR.rotation.z = -0.9 + Math.sin(this.t * 7) * 0.5;
    } else if (this.state === 'success') {
      this.armL.rotation.z = 0.9; this.armR.rotation.z = -0.9;
      this.root.position.y = Math.max(0, Math.sin(this.stateT * 9)) * 0.12 * Math.max(0, 1 - this.stateT);
    } else if (this.state === 'mistake') {
      this.head.rotation.z = Math.sin(this.stateT * 20) * 0.1 * Math.max(0, 1 - this.stateT * 2);
      this.armR.rotation.z += (0 - this.armR.rotation.z) * settle;
      this.armL.rotation.z += (0 - this.armL.rotation.z) * settle;
    } else {
      this.armL.rotation.z += (0 - this.armL.rotation.z) * settle;
      this.armR.rotation.z += (0 - this.armR.rotation.z) * settle;
      this.head.rotation.z += (0 - this.head.rotation.z) * settle;
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
