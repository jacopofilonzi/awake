/** Counts failures per key (IP, username…) in a fixed window, in memory. */
export class RateLimiter {
  private failures = new Map<string, { count: number; resetAt: number }>();
  private sweeper: NodeJS.Timeout;

  constructor(
    private maxFailures: number,
    private windowMs: number,
  ) {
    this.sweeper = setInterval(() => this.sweep(), Math.min(windowMs, 60_000));
    this.sweeper.unref();
  }

  isBlocked(key: string): boolean {
    const entry = this.failures.get(key);
    if (!entry) return false;
    if (Date.now() > entry.resetAt) {
      this.failures.delete(key);
      return false;
    }
    return entry.count >= this.maxFailures;
  }

  recordFailure(key: string): void {
    const now = Date.now();
    const entry = this.failures.get(key);
    if (!entry || now > entry.resetAt) this.failures.set(key, { count: 1, resetAt: now + this.windowMs });
    else entry.count++;
  }

  close(): void {
    clearInterval(this.sweeper);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.failures) if (now > entry.resetAt) this.failures.delete(key);
  }
}

/** The limiters of the server, grouped so they can be passed around and closed together. */
export class Limiters {
  /** Failed logins / password-link / registration attempts per client IP. */
  readonly ip = new RateLimiter(10, 10 * 60_000);
  /** Failed logins per username: slows down attacks spread over many IPs. */
  readonly username = new RateLimiter(50, 60 * 60_000);
  /** Failed agent authentications per IP. */
  readonly agent = new RateLimiter(10, 10 * 60_000);

  close(): void {
    this.ip.close();
    this.username.close();
    this.agent.close();
  }
}
