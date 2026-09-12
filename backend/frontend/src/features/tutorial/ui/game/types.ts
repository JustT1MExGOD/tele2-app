/** Shared types for the T2 Academy 3D episode — kept dependency-free of
 * three.js where possible so non-rendering modules (input, quality) stay
 * easy to unit-test without a WebGL context. */
export type QualityProfile = 'high' | 'low';

export interface InputFrame {
  moveX: number; // -1..1, strafe
  moveZ: number; // -1..1, forward(-1)/back(1)
  lookDX: number; // pointer/touch delta yaw this frame, radians
  lookDY: number; // pointer/touch delta pitch this frame, radians
  interact: boolean; // edge-triggered: true for exactly one frame per press
  run: boolean;
}

export type InteractableKind = 'arbuzych' | 'terminal' | 'register' | 'exit';

export interface Interactable {
  id: InteractableKind;
  object: import('three').Object3D;
  radius: number;
  label: string;
  enabled: () => boolean;
  onInteract: () => void;
}
