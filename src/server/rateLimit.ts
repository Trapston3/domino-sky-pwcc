export const DEFAULT_RATE_LIMIT_MAX = 20;
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_MAX_TRACKED_KEYS = 2048;

export interface RateLimitOptions {
  maxRequests?: number;
  windowMs?: number;
  maxTrackedKeys?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  status: 200 | 429;
  limit: number;
  remaining: number;
  resetAtMs: number;
  retryAfterSec: number;
}

/**
 * Best-effort per-instance in-memory sliding-window rate limiter.
 *
 * Defaults to 20 requests per 60,000 ms per client IP. Because serverless
 * runtimes (such as Vercel functions) may spin up multiple concurrent instances
 * or recycle cold instances, limits are enforced independently per warm
 * instance rather than globally across a distributed store.
 */
export class SlidingWindowRateLimiter {
  readonly maxRequests: number;
  readonly windowMs: number;
  private readonly maxTrackedKeys: number;
  private readonly hits = new Map<string, number[]>();

  constructor(options: RateLimitOptions = {}) {
    const maxRequests = options.maxRequests ?? DEFAULT_RATE_LIMIT_MAX;
    const windowMs = options.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS;
    const maxTrackedKeys = options.maxTrackedKeys ?? DEFAULT_MAX_TRACKED_KEYS;

    if (!Number.isInteger(maxRequests) || maxRequests < 1) {
      throw new RangeError('maxRequests must be a positive integer.');
    }
    if (!Number.isFinite(windowMs) || windowMs < 1) {
      throw new RangeError('windowMs must be a positive number.');
    }
    if (!Number.isInteger(maxTrackedKeys) || maxTrackedKeys < 1) {
      throw new RangeError('maxTrackedKeys must be a positive integer.');
    }

    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.maxTrackedKeys = maxTrackedKeys;
  }

  /**
   * Check whether a request from `ip` is permitted at timestamp `now` (ms).
   * Permitted requests are recorded in the sliding window; rejected requests
   * (429) are not added so the caller recovers once older hits expire.
   */
  check(ip: string, now = Date.now()): RateLimitResult {
    const key = ip.trim() || 'unknown';
    const cutoff = now - this.windowMs;
    const existing = this.hits.get(key);
    const active = existing ? existing.filter((ts) => ts > cutoff) : [];

    if (active.length === 0 && existing) {
      this.hits.delete(key);
    }

    if (active.length >= this.maxRequests) {
      if (existing) {
        this.hits.set(key, active);
      }
      const oldest = active[0]!;
      const resetAtMs = oldest + this.windowMs;
      const retryAfterSec = Math.max(1, Math.ceil((resetAtMs - now) / 1000));
      return {
        allowed: false,
        status: 429,
        limit: this.maxRequests,
        remaining: 0,
        resetAtMs,
        retryAfterSec,
      };
    }

    if (!this.hits.has(key) && this.hits.size >= this.maxTrackedKeys) {
      this.pruneOldKeys(cutoff);
      if (this.hits.size >= this.maxTrackedKeys) {
        const oldestKey = this.hits.keys().next().value;
        if (oldestKey !== undefined) {
          this.hits.delete(oldestKey);
        }
      }
    }

    active.push(now);
    this.hits.set(key, active);

    const oldest = active[0]!;
    return {
      allowed: true,
      status: 200,
      limit: this.maxRequests,
      remaining: this.maxRequests - active.length,
      resetAtMs: oldest + this.windowMs,
      retryAfterSec: 0,
    };
  }

  /**
   * Clear tracked timestamps for a single IP, or all IPs when omitted.
   */
  reset(ip?: string): void {
    if (ip === undefined) {
      this.hits.clear();
      return;
    }
    const key = ip.trim() || 'unknown';
    this.hits.delete(key);
  }

  private pruneOldKeys(cutoff: number): void {
    for (const [key, timestamps] of this.hits.entries()) {
      const remaining = timestamps.filter((ts) => ts > cutoff);
      if (remaining.length === 0) {
        this.hits.delete(key);
      } else if (remaining.length !== timestamps.length) {
        this.hits.set(key, remaining);
      }
    }
  }
}
