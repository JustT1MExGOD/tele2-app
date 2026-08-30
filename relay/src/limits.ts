/**
 * Request limits and basic per-IP abuse throttling. Deliberately simple
 * (in-memory, this relay instance's own concern) — the backend's own
 * distributed, account-based rate limiter (backend/src/security/
 * rate-limit.ts) still applies unchanged to every relayed request once
 * it reaches the backend; this is just cheap, structural protection
 * against the relay itself being trivially abused as infrastructure
 * (connection exhaustion, oversized bodies), independent of and much
 * simpler than that concern.
 */

export class ConcurrencyLimiter {
  private active = 0;
  constructor(private readonly max: number) {}

  tryAcquire(): boolean {
    if (this.active >= this.max) return false;
    this.active += 1;
    return true;
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
  }

  get activeCount(): number {
    return this.active;
  }
}

/** Fixed-window per-IP counter — same class of simplification as the
 * backend's own documented fixed-window rate limiter trade-off (allows
 * a small burst at window boundaries; not meaningful for this threat
 * model, which is "don't let the relay itself become a resource-exhaustion
 * target," not precise per-second fairness). */
export class PerIpThrottle {
  private counts = new Map<string, { windowStart: number; count: number }>();
  constructor(private readonly maxPerMinute: number) {}

  allow(ip: string, now: number = Date.now()): boolean {
    const windowMs = 60_000;
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const entry = this.counts.get(ip);
    if (!entry || entry.windowStart !== windowStart) {
      this.counts.set(ip, { windowStart, count: 1 });
      this.cleanup(windowStart);
      return true;
    }
    entry.count += 1;
    return entry.count <= this.maxPerMinute;
  }

  private cleanup(currentWindowStart: number): void {
    // Bounded map growth — drop stale windows opportunistically rather
    // than running a separate timer.
    if (this.counts.size < 10_000) return;
    for (const [ip, entry] of this.counts) {
      if (entry.windowStart !== currentWindowStart) this.counts.delete(ip);
    }
  }
}
