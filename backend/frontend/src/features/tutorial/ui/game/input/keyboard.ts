/** Desktop input: WASD/arrows move, mouse-drag looks around (no pointer
 * lock requirement — brief explicitly says not to force capture since it
 * would fight the surrounding app chrome), E interacts, Escape closes.
 * Held keys reset on window blur so a focus loss never leaves a "stuck"
 * movement key active. */
export class KeyboardInput {
  private keys = new Set<string>();
  private interactQueued = false;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private lookDX = 0;
  private lookDY = 0;
  private onEscape?: () => void;

  constructor(private host: HTMLElement, opts: { onEscape?: () => void } = {}) {
    this.onEscape = opts.onEscape;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.reset);
    host.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    const key = e.key.toLowerCase();
    this.keys.add(key);
    if (key === 'e') this.interactQueued = true;
    if (key === 'escape') this.onEscape?.();
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
  private reset = () => { this.keys.clear(); this.dragging = false; };

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY;
  };
  private onPointerMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    this.lookDX += (e.clientX - this.lastX) * -0.0032;
    this.lookDY += (e.clientY - this.lastY) * -0.0022;
    this.lastX = e.clientX; this.lastY = e.clientY;
  };
  private onPointerUp = () => { this.dragging = false; };

  /** Call once per rendered frame; consumes and resets the per-frame deltas. */
  poll(): { moveX: number; moveZ: number; lookDX: number; lookDY: number; interact: boolean; run: boolean } {
    let moveX = 0, moveZ = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) moveZ -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) moveZ += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) moveX -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) moveX += 1;
    const interact = this.interactQueued;
    this.interactQueued = false;
    const lookDX = this.lookDX, lookDY = this.lookDY;
    this.lookDX = 0; this.lookDY = 0;
    return { moveX, moveZ, lookDX, lookDY, interact, run: this.keys.has('shift') };
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.reset);
    this.host.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
  }
}
