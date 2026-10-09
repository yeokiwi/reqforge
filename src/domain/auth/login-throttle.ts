// Limits repeated failed sign-ins for one key (e.g. an email address). In-memory and
// per-process: a multi-instance deployment needs a shared store behind the same interface.
// The clock is injected so the policy is testable without sleeping.

export interface ThrottleOptions {
  /** Failures allowed inside the window before further attempts are refused. */
  readonly maxFailures: number;
  readonly windowMs: number;
  readonly now: () => number;
  /** Upper bound on tracked keys, so an attacker cannot grow the map without limit. */
  readonly maxKeys: number;
}

const DEFAULTS: ThrottleOptions = {
  maxFailures: 8,
  windowMs: 15 * 60 * 1000,
  now: () => Date.now(),
  maxKeys: 10_000,
};

export class LoginThrottle {
  private readonly options: ThrottleOptions;
  private readonly failures = new Map<string, number[]>();

  constructor(options: Partial<ThrottleOptions> = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  /** Seconds until the key may try again, or 0 if it may try now. */
  retryAfterSeconds(key: string): number {
    const recent = this.recentFailures(key);
    if (recent.length < this.options.maxFailures) return 0;
    const oldest = recent[0] as number;
    return Math.max(1, Math.ceil((oldest + this.options.windowMs - this.options.now()) / 1000));
  }

  recordFailure(key: string): void {
    const recent = this.recentFailures(key);
    recent.push(this.options.now());
    this.failures.delete(key); // re-insert so Map order tracks recency
    this.failures.set(key, recent);
    while (this.failures.size > this.options.maxKeys) {
      const eldest = this.failures.keys().next().value;
      if (eldest === undefined) break;
      this.failures.delete(eldest);
    }
  }

  reset(key: string): void {
    this.failures.delete(key);
  }

  private recentFailures(key: string): number[] {
    const cutoff = this.options.now() - this.options.windowMs;
    return (this.failures.get(key) ?? []).filter((at) => at > cutoff);
  }
}
