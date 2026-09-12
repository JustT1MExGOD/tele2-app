import * as THREE from 'three';
import type { Interactable, InteractableKind } from '../types.js';

/** Finds the nearest enabled interactable within range of the player —
 * proximity alone, not facing, decides eligibility (facing-gated prompts
 * feel finicky at this camera distance); pressing E/tap while the prompt
 * is shown is what completes the specific mission action, so "walking
 * near an object" alone never counts as completing it (brief §3: "подход
 * к объекту сам по себе не означает выполненную продажу"). */
export class InteractionSystem {
  private list: Interactable[] = [];
  current: Interactable | null = null;

  register(item: Interactable): void { this.list.push(item); }
  unregisterAll(): void { this.list = []; }
  byId(id: InteractableKind): Interactable | undefined { return this.list.find((i) => i.id === id); }

  update(playerPos: THREE.Vector3): Interactable | null {
    let best: Interactable | null = null;
    let bestDist = Infinity;
    for (const item of this.list) {
      if (!item.enabled()) continue;
      const d = item.object.position.distanceTo(playerPos);
      if (d <= item.radius && d < bestDist) { best = item; bestDist = d; }
    }
    this.current = best;
    return best;
  }

  triggerCurrent(): boolean {
    if (!this.current) return false;
    this.current.onInteract();
    return true;
  }
}
