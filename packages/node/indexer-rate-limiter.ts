// A request scheduler that smooths outbound calls to one shared upstream so a pool of
// independent clients doesn't trip its rate limiter. The hosted Midnight indexer
// WAF-throttles by IP, and the clients hitting it (Apollo polling, the wallet SDK, the
// block scanner) expose no rate hook — so they all pass through this one choke point:
// concurrency cap, min-interval spacing, coalescing of identical in-flight reads, and
// backoff on 429/403 (honoring Retry-After). Clock/timer are injectable for tests.

export interface RateLimiterOptions {
  maxConcurrency: number;
  minIntervalMs: number;
  baseCooldownMs: number;
  maxCooldownMs: number;
  /** Max queued (not-yet-dispatched) requests before new ones are rejected as backpressure. */
  maxQueue?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => void;
}

export interface UpstreamResult {
  status: number;
  /** Retry-After in ms, if the upstream sent one. */
  retryAfterMs?: number;
}

// A limit signal (429/403) grows the cooldown geometrically to the cap, or honors a
// longer Retry-After; any other status clears it. Pure, so the curve is unit-tested.
export function nextCooldownMs(
  prevCooldownMs: number,
  result: UpstreamResult,
  opts: Pick<RateLimiterOptions, "baseCooldownMs" | "maxCooldownMs">,
): number {
  const limited = result.status === 429 || result.status === 403;
  if (!limited) return 0;
  const grown = prevCooldownMs > 0 ? prevCooldownMs * 2 : opts.baseCooldownMs;
  // Honor Retry-After when longer than the geometric step, but never exceed the cap — an
  // upstream/WAF Retry-After of hours must not wedge the whole gateway for hours.
  return Math.min(Math.max(grown, result.retryAfterMs ?? 0), opts.maxCooldownMs);
}

/** Parse a Retry-After header value (delta-seconds or HTTP-date) into ms. */
export function parseRetryAfterMs(
  headerValue: string | null,
  now: number,
): number | undefined {
  if (!headerValue) return undefined;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(headerValue);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return undefined;
}

type Job<T> = {
  key: string | null;
  task: () => Promise<T & UpstreamResult>;
  resolve: (v: T & UpstreamResult) => void;
  reject: (e: unknown) => void;
};

export class IndexerRateLimiter {
  private readonly opts: Required<RateLimiterOptions>;
  private readonly queue: Job<any>[] = [];
  private readonly inflightByKey = new Map<string, Promise<any>>();
  private running = 0;
  private nextDispatchAt = 0;
  private cooldownUntil = 0;
  private cooldownMs = 0;
  private pumpScheduled = false;

  constructor(options: RateLimiterOptions) {
    this.opts = {
      now: () => Date.now(),
      setTimer: (fn, ms) => {
        setTimeout(fn, ms);
      },
      maxQueue: 5000,
      ...options,
    };
  }

  /**
   * Run `task` under the rate limit and return its result. When `key` is set and an
   * identical request is already in flight, the in-flight one is shared instead of
   * issuing a second upstream call (safe only for idempotent reads — the caller
   * decides by passing a key or null).
   */
  schedule<T>(
    key: string | null,
    task: () => Promise<T & UpstreamResult>,
  ): Promise<T & UpstreamResult> {
    if (key !== null) {
      const existing = this.inflightByKey.get(key);
      if (existing) return existing as Promise<T & UpstreamResult>;
    }
    // Bound the queue so a stuck upstream (or a long cooldown) can't grow it without
    // limit — shed load with an error the caller surfaces as a 5xx instead of OOMing.
    if (this.queue.length >= this.opts.maxQueue) {
      return Promise.reject(new Error("indexer rate limiter: queue full (upstream overloaded)"));
    }
    const p = new Promise<T & UpstreamResult>((resolve, reject) => {
      this.queue.push({ key, task, resolve, reject });
    });
    if (key !== null) {
      this.inflightByKey.set(key, p);
      // Drop the coalescing entry once settled so later identical requests re-issue.
      const clear = () => this.inflightByKey.delete(key);
      p.then(clear, clear);
    }
    this.pump();
    return p;
  }

  /** Cooldown remaining right now, in ms — exposed for observability/tests. */
  cooldownRemainingMs(): number {
    return Math.max(0, this.cooldownUntil - this.opts.now());
  }

  private pump(): void {
    if (this.running >= this.opts.maxConcurrency) return;
    if (this.queue.length === 0) return;

    const now = this.opts.now();
    const waitFor = Math.max(this.nextDispatchAt - now, this.cooldownUntil - now, 0);
    if (waitFor > 0) {
      if (!this.pumpScheduled) {
        this.pumpScheduled = true;
        this.opts.setTimer(() => {
          this.pumpScheduled = false;
          this.pump();
        }, waitFor);
      }
      return;
    }

    const job = this.queue.shift()!;
    this.running += 1;
    this.nextDispatchAt = now + this.opts.minIntervalMs;

    job
      .task()
      .then(
        (res) => {
          this.cooldownMs = nextCooldownMs(this.cooldownMs, res, this.opts);
          this.cooldownUntil = this.cooldownMs > 0 ? this.opts.now() + this.cooldownMs : 0;
          job.resolve(res);
        },
        (err) => job.reject(err),
      )
      .finally(() => {
        this.running -= 1;
        this.pump();
      });

    // Fill remaining concurrency slots in the same tick.
    this.pump();
  }
}
