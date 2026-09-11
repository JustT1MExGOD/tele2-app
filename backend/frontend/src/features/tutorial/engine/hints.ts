/**
 * Idle → hint escalation. "User waits too long: idle → hint state" — a
 * plain timer, restart on any user interaction the caller reports.
 */
export class HintTimer {
  private timeoutMs: number;
  private handle: ReturnType<typeof setTimeout> | null = null;
  private onHint: () => void;

  constructor(onHint: () => void, timeoutMs = 15000) {
    this.onHint = onHint;
    this.timeoutMs = timeoutMs;
  }

  start(): void {
    this.stop();
    this.handle = setTimeout(() => this.onHint(), this.timeoutMs);
  }

  /** Call on any user interaction with the current step — pushes the hint
   * further out rather than firing it. */
  reset(): void {
    this.start();
  }

  stop(): void {
    if (this.handle) {
      clearTimeout(this.handle);
      this.handle = null;
    }
  }
}
