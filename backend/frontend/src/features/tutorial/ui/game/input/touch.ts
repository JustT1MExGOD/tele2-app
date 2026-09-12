/** Mobile input: a virtual joystick (bottom-left) for movement and a
 * separate look-pad (right half of the world view) for camera rotation.
 * Each zone tracks its own pointer id so simultaneous multi-touch (moving
 * while looking) works, and neither zone overlaps the dialogue panel or
 * HUD buttons (those sit in their own DOM layer with their own pointer
 * events — see hud/dialogue), so scrolling/tapping there never fights the
 * joystick per the brief's explicit requirement. */
export class TouchInput {
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private lookPad: HTMLDivElement;
  private interactBtn: HTMLButtonElement;
  private moveX = 0;
  private moveZ = 0;
  private lookDX = 0;
  private lookDY = 0;
  private interactQueued = false;
  private movePointerId: number | null = null;
  private lookPointerId: number | null = null;
  private lookLastX = 0;
  private lookLastY = 0;
  private baseRect = { x: 0, y: 0 };
  readonly interactVisible = { value: false };

  constructor(private host: HTMLElement, onInteractLabelHost: HTMLElement) {
    this.base = document.createElement('div');
    this.base.className = 'academy-3d-joystick-base';
    this.knob = document.createElement('div');
    this.knob.className = 'academy-3d-joystick-knob';
    this.base.appendChild(this.knob);
    host.appendChild(this.base);

    this.lookPad = document.createElement('div');
    this.lookPad.className = 'academy-3d-lookpad';
    host.appendChild(this.lookPad);

    this.interactBtn = document.createElement('button');
    this.interactBtn.type = 'button';
    this.interactBtn.className = 'academy-3d-interact-btn';
    this.interactBtn.hidden = true;
    this.interactBtn.textContent = 'Взаимодействовать';
    onInteractLabelHost.appendChild(this.interactBtn);

    this.base.addEventListener('pointerdown', this.onBaseDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    this.lookPad.addEventListener('pointerdown', this.onLookDown);
    this.interactBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.interactQueued = true; });
  }

  private onBaseDown = (e: PointerEvent) => {
    if (this.movePointerId !== null) return;
    this.movePointerId = e.pointerId;
    const rect = this.base.getBoundingClientRect();
    this.baseRect = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    this.updateKnob(e.clientX, e.clientY);
  };
  private onLookDown = (e: PointerEvent) => {
    if (this.lookPointerId !== null) return;
    this.lookPointerId = e.pointerId;
    this.lookLastX = e.clientX; this.lookLastY = e.clientY;
  };
  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerId === this.movePointerId) this.updateKnob(e.clientX, e.clientY);
    else if (e.pointerId === this.lookPointerId) {
      this.lookDX += (e.clientX - this.lookLastX) * -0.0042;
      this.lookDY += (e.clientY - this.lookLastY) * -0.003;
      this.lookLastX = e.clientX; this.lookLastY = e.clientY;
    }
  };
  private onPointerUp = (e: PointerEvent) => {
    if (e.pointerId === this.movePointerId) {
      this.movePointerId = null; this.moveX = 0; this.moveZ = 0;
      this.knob.style.transform = 'translate(-50%, -50%)';
    }
    if (e.pointerId === this.lookPointerId) this.lookPointerId = null;
  };
  private updateKnob(cx: number, cy: number): void {
    const max = 34;
    let dx = cx - this.baseRect.x, dy = cy - this.baseRect.y;
    const len = Math.hypot(dx, dy) || 1;
    const clamped = Math.min(1, len / max);
    dx = (dx / len) * clamped; dy = (dy / len) * clamped;
    this.knob.style.transform = `translate(calc(-50% + ${dx * max}px), calc(-50% + ${dy * max}px))`;
    this.moveX = dx; this.moveZ = dy;
  }

  setInteractVisible(visible: boolean, label: string): void {
    this.interactBtn.hidden = !visible;
    this.interactBtn.textContent = label;
  }

  poll(): { moveX: number; moveZ: number; lookDX: number; lookDY: number; interact: boolean; run: boolean } {
    const interact = this.interactQueued;
    this.interactQueued = false;
    const lookDX = this.lookDX, lookDY = this.lookDY;
    this.lookDX = 0; this.lookDY = 0;
    return { moveX: this.moveX, moveZ: this.moveZ, lookDX, lookDY, interact, run: false };
  }

  destroy(): void {
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.base.remove();
    this.lookPad.remove();
    this.interactBtn.remove();
  }
}
