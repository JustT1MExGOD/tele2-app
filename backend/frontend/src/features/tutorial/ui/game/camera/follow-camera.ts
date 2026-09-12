import * as THREE from 'three';

/** Third-person orbit-follow camera. Yaw/pitch driven by look input, the
 * camera itself lerps toward the ideal orbit position and shortens its
 * distance when a wall/prop collider would otherwise clip through it —
 * "avoids walls and never passes through the shopfront" from the brief,
 * done cheaply via a circle-vs-segment test against the shop's XZ
 * colliders rather than a full physics engine. */
export class FollowCamera {
  yaw = Math.PI;
  pitch = -0.18;
  distance = 3.4;
  private readonly minPitch = -0.85;
  private readonly maxPitch = 0.35;
  private currentPos = new THREE.Vector3();
  private initialized = false;

  constructor(private colliders: { center: THREE.Vector2; radius: number }[]) {}

  applyLook(dx: number, dy: number): void {
    this.yaw += dx;
    this.pitch = Math.min(this.maxPitch, Math.max(this.minPitch, this.pitch + dy));
  }

  private clampDistance(target: THREE.Vector3, dirToCam: THREE.Vector3): number {
    let dist = this.distance;
    const p2 = new THREE.Vector2(target.x, target.z);
    const d2 = new THREE.Vector2(dirToCam.x, dirToCam.z).normalize();
    for (const c of this.colliders) {
      const toCollider = c.center.clone().sub(p2);
      const along = toCollider.dot(d2);
      if (along <= 0 || along > dist) continue;
      const closest = p2.clone().add(d2.clone().multiplyScalar(along));
      const perpDist = closest.distanceTo(c.center);
      if (perpDist < c.radius + 0.3) dist = Math.min(dist, Math.max(0.9, along - c.radius));
    }
    return dist;
  }

  update(dt: number, camera: THREE.PerspectiveCamera, targetPos: THREE.Vector3, targetHeadY: number, lookAtOverride?: THREE.Vector3): void {
    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    const focus = new THREE.Vector3(targetPos.x, targetHeadY, targetPos.z);
    const dist = this.clampDistance(focus, dir);
    const ideal = focus.clone().addScaledVector(dir, dist);
    ideal.y = Math.max(ideal.y, 0.3);
    if (!this.initialized) { this.currentPos.copy(ideal); this.initialized = true; }
    const lerp = 1 - Math.pow(0.001, dt);
    this.currentPos.lerp(ideal, lerp);
    camera.position.copy(this.currentPos);
    camera.lookAt(lookAtOverride ?? focus);
  }

  snapBehind(targetPos: THREE.Vector3, facingYaw: number): void {
    this.yaw = facingYaw + Math.PI;
    this.initialized = false;
  }
}
