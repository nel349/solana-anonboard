import { describe, test, expect } from "bun:test";
import {
  IndexerRateLimiter,
  nextCooldownMs,
  parseRetryAfterMs,
  type UpstreamResult,
} from "./indexer-rate-limiter.ts";

// ── deterministic fake clock ────────────────────────────────────────────────
function fakeClock() {
  let now = 0;
  const timers: { at: number; fn: () => void }[] = [];
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => timers.push({ at: now + ms, fn }),
    advance(ms: number) {
      const target = now + ms;
      // Fire due timers in order; a fired timer may schedule more.
      for (;;) {
        const idx = timers
          .map((t, i) => ({ t, i }))
          .filter(({ t }) => t.at <= target)
          .sort((a, b) => a.t.at - b.t.at)[0];
        if (!idx) break;
        timers.splice(idx.i, 1);
        now = Math.max(now, idx.t.at);
        idx.t.fn();
      }
      now = target;
    },
  };
}

// Let queued microtasks (the .then/.finally pump chain) settle.
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const ok: UpstreamResult = { status: 200 };

describe("nextCooldownMs", () => {
  const opts = { baseCooldownMs: 500, maxCooldownMs: 8000 };

  test("a healthy response clears the cooldown", () => {
    expect(nextCooldownMs(4000, { status: 200 }, opts)).toBe(0);
  });

  test("first limit signal uses the base step", () => {
    expect(nextCooldownMs(0, { status: 403 }, opts)).toBe(500);
    expect(nextCooldownMs(0, { status: 429 }, opts)).toBe(500);
  });

  test("repeated limits grow geometrically up to the cap", () => {
    expect(nextCooldownMs(500, { status: 403 }, opts)).toBe(1000);
    expect(nextCooldownMs(1000, { status: 403 }, opts)).toBe(2000);
    expect(nextCooldownMs(8000, { status: 403 }, opts)).toBe(8000); // capped
  });

  test("an explicit Retry-After wins when longer than the computed backoff, but is clamped to the cap", () => {
    expect(nextCooldownMs(500, { status: 429, retryAfterMs: 5000 }, opts)).toBe(5000);
    expect(nextCooldownMs(500, { status: 429, retryAfterMs: 100 }, opts)).toBe(1000);
    // A pathological/WAF Retry-After (hours) must NOT exceed maxCooldownMs — else one
    // header wedges the whole gateway.
    expect(nextCooldownMs(500, { status: 403, retryAfterMs: 86_400_000 }, opts)).toBe(8000);
  });
});

describe("parseRetryAfterMs", () => {
  test("delta-seconds", () => {
    expect(parseRetryAfterMs("3", 0)).toBe(3000);
  });
  test("http-date relative to now", () => {
    const now = Date.parse("2020-01-01T00:00:00Z");
    expect(parseRetryAfterMs("Wed, 01 Jan 2020 00:00:10 GMT", now)).toBe(10000);
  });
  test("missing or unparseable → undefined", () => {
    expect(parseRetryAfterMs(null, 0)).toBeUndefined();
    expect(parseRetryAfterMs("later", 0)).toBeUndefined();
  });
});

describe("IndexerRateLimiter", () => {
  test("caps in-flight requests at maxConcurrency", async () => {
    const clock = fakeClock();
    const rl = new IndexerRateLimiter({
      maxConcurrency: 2,
      minIntervalMs: 0,
      baseCooldownMs: 100,
      maxCooldownMs: 1000,
      now: clock.now,
      setTimer: clock.setTimer,
    });
    const gates = Array.from({ length: 5 }, () => deferred<UpstreamResult>());
    let started = 0;
    const results = gates.map((g) =>
      rl.schedule(null, () => {
        started += 1;
        return g.promise;
      }),
    );

    await flush();
    expect(started).toBe(2); // only 2 dispatched

    gates[0].resolve(ok);
    await flush();
    expect(started).toBe(3); // one slot freed → one more dispatched

    gates[1].resolve(ok);
    gates[2].resolve(ok);
    await flush();
    expect(started).toBe(5); // all dispatched, still ≤2 at any instant

    gates[3].resolve(ok);
    gates[4].resolve(ok);
    await Promise.all(results);
  });

  test("coalesces identical in-flight requests into one upstream call", async () => {
    const rl = new IndexerRateLimiter({
      maxConcurrency: 4,
      minIntervalMs: 0,
      baseCooldownMs: 100,
      maxCooldownMs: 1000,
    });
    const g = deferred<UpstreamResult>();
    let calls = 0;
    const task = () => {
      calls += 1;
      return g.promise;
    };
    const a = rl.schedule("same", task);
    const b = rl.schedule("same", task);
    expect(a).toBe(b); // same promise handed back
    g.resolve({ status: 200 });
    await Promise.all([a, b]);
    expect(calls).toBe(1);
  });

  test("re-issues an identical request once the prior one has settled", async () => {
    const rl = new IndexerRateLimiter({
      maxConcurrency: 4,
      minIntervalMs: 0,
      baseCooldownMs: 100,
      maxCooldownMs: 1000,
    });
    let calls = 0;
    const task = () => {
      calls += 1;
      return Promise.resolve(ok);
    };
    await rl.schedule("k", task);
    await rl.schedule("k", task);
    expect(calls).toBe(2);
  });

  test("spaces dispatches by minIntervalMs", async () => {
    const clock = fakeClock();
    const rl = new IndexerRateLimiter({
      maxConcurrency: 10,
      minIntervalMs: 100,
      baseCooldownMs: 100,
      maxCooldownMs: 1000,
      now: clock.now,
      setTimer: clock.setTimer,
    });
    const starts: number[] = [];
    const task = () => {
      starts.push(clock.now());
      return Promise.resolve(ok);
    };
    rl.schedule(null, task);
    rl.schedule(null, task);
    rl.schedule(null, task);

    await flush();
    expect(starts).toEqual([0]); // first dispatches immediately

    clock.advance(100);
    await flush();
    clock.advance(100);
    await flush();
    expect(starts).toEqual([0, 100, 200]);
  });

  test("rejects new requests when the queue is full (backpressure, not OOM)", async () => {
    const rl = new IndexerRateLimiter({
      maxConcurrency: 1,
      minIntervalMs: 0,
      baseCooldownMs: 100,
      maxCooldownMs: 1000,
      maxQueue: 2,
    });
    const gate = deferred<UpstreamResult>();
    const a = rl.schedule(null, () => gate.promise); // dispatched (running)
    const b = rl.schedule(null, () => gate.promise); // queued (1)
    const c = rl.schedule(null, () => gate.promise); // queued (2 = full)
    await expect(rl.schedule(null, () => gate.promise)).rejects.toThrow(/queue full/);
    gate.resolve(ok);
    await Promise.allSettled([a, b, c]);
  });

  test("backs off dispatch after a limit signal", async () => {
    const clock = fakeClock();
    const rl = new IndexerRateLimiter({
      maxConcurrency: 1,
      minIntervalMs: 0,
      baseCooldownMs: 500,
      maxCooldownMs: 8000,
      now: clock.now,
      setTimer: clock.setTimer,
    });
    const starts: number[] = [];
    const first = () => {
      starts.push(clock.now());
      return Promise.resolve<UpstreamResult>({ status: 429 });
    };
    const second = () => {
      starts.push(clock.now());
      return Promise.resolve(ok);
    };
    rl.schedule(null, first);
    rl.schedule(null, second);

    await flush();
    expect(starts).toEqual([0]); // first ran; second held by the new cooldown

    clock.advance(499);
    await flush();
    expect(starts).toEqual([0]); // still cooling down

    clock.advance(1);
    await flush();
    expect(starts).toEqual([0, 500]); // dispatched once the cooldown elapsed
  });
});
