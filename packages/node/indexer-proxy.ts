// A local rate-limiting gateway in front of a hosted Midnight indexer. Server-side
// clients point here instead of the indexer, so their combined request rate is shaped
// in one place and stays under the per-IP WAF limit. HTTP GraphQL is throttled,
// coalesced, and retried through the limiter; graphql-ws subscriptions pass straight
// through (long-lived connections, not the flood). The request path is preserved on
// forward. Config via INDEXER_PROXY_* env (port, HTTP/WS origins, limiter tuning).

import { IndexerRateLimiter, parseRetryAfterMs } from "./indexer-rate-limiter.ts";
import { coalesceKey, filterResponseHeaders } from "./indexer-proxy-lib.ts";

const num = (name: string, fallback: number, min = 0): number => {
  const raw = process.env[name];
  const n = raw === undefined ? NaN : Number(raw);
  // Below `min` (e.g. a stray 0 or "" for a ≥1 knob) falls back — a 0 concurrency or 0
  // attempts would hang every request or 502 it.
  return Number.isFinite(n) && n >= min ? n : fallback;
};
const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`indexer-proxy: ${name} is required`);
  return v;
};

const PORT = num("INDEXER_PROXY_PORT", 8079, 1);
const HTTP_ORIGIN = required("INDEXER_PROXY_HTTP_ORIGIN").replace(/\/+$/, "");
const WS_ORIGIN = required("INDEXER_PROXY_WS_ORIGIN").replace(/\/+$/, "");
const MAX_ATTEMPTS = num("INDEXER_PROXY_MAX_ATTEMPTS", 4, 1);

const LIMITS = {
  maxConcurrency: num("INDEXER_PROXY_MAX_CONCURRENCY", 3, 1),
  minIntervalMs: num("INDEXER_PROXY_MIN_INTERVAL_MS", 150),
  baseCooldownMs: num("INDEXER_PROXY_BASE_COOLDOWN_MS", 1000),
  maxCooldownMs: num("INDEXER_PROXY_MAX_COOLDOWN_MS", 20000),
};
const limiter = new IndexerRateLimiter(LIMITS);

type Buffered = {
  status: number;
  retryAfterMs?: number;
  headers: [string, string][];
  body: ArrayBuffer;
};

async function forwardOnce(
  method: string,
  upstreamUrl: string,
  headers: Headers,
  body: ArrayBuffer | null,
): Promise<Buffered> {
  const res = await fetch(upstreamUrl, {
    method,
    headers,
    body: body ?? undefined,
  });
  const buf = await res.arrayBuffer();
  return {
    status: res.status,
    retryAfterMs: parseRetryAfterMs(res.headers.get("retry-after"), Date.now()),
    headers: [...res.headers.entries()],
    body: buf,
  };
}

function toResponse(b: Buffered): Response {
  return new Response(b.body, { status: b.status, headers: filterResponseHeaders(b.headers) });
}

async function handleHttp(req: Request, url: URL): Promise<Response> {
  const upstreamUrl = HTTP_ORIGIN + url.pathname + url.search;
  const bodyBuf = req.method === "GET" || req.method === "HEAD" ? null : await req.arrayBuffer();
  const bodyText = bodyBuf ? new TextDecoder().decode(bodyBuf) : "";
  const key = req.method === "POST" && bodyText ? coalesceKey(bodyText) : null;

  // Forward only the request headers the upstream needs; drop the localhost Host
  // so fetch sets the upstream one.
  const fwdHeaders = new Headers(req.headers);
  fwdHeaders.delete("host");
  fwdHeaders.delete("content-length");

  let last: Buffered | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const result = await limiter.schedule<Buffered>(key, () =>
      forwardOnce(req.method, upstreamUrl, fwdHeaders, bodyBuf),
    );
    last = result;
    // Absorb transient WAF limits on READS here so a raw 403 never reaches the client's
    // retry layer (which would amplify it); the limiter's cooldown paces the retry. Never
    // retry a mutation (key === null): re-sending a write on a 403/429 risks a double
    // write if the upstream ever 4xx'd post-execution — surface it to the client instead.
    const limited = result.status === 429 || result.status === 403;
    if (!limited || key === null || attempt === MAX_ATTEMPTS - 1) return toResponse(result);
  }
  return toResponse(last!);
}

type WsData = { upstreamUrl: string; protocol: string | null };

const server = Bun.serve<WsData>({
  port: PORT,
  idleTimeout: 0, // long-lived subscriptions must not be reaped
  async fetch(req, srv) {
    const url = new URL(req.url);
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const offered = req.headers.get("sec-websocket-protocol");
      const protocol = offered ? offered.split(",")[0]!.trim() : null;
      const ok = srv.upgrade(req, {
        data: { upstreamUrl: WS_ORIGIN + url.pathname + url.search, protocol },
        headers: protocol ? { "Sec-WebSocket-Protocol": protocol } : undefined,
      });
      return ok ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
    }
    try {
      return await handleHttp(req, url);
    } catch (e) {
      return new Response(`indexer-proxy upstream error: ${(e as Error).message}`, {
        status: 502,
      });
    }
  },
  websocket: {
    open(ws) {
      const { upstreamUrl, protocol } = ws.data;
      const up = protocol
        ? new WebSocket(upstreamUrl, protocol)
        : new WebSocket(upstreamUrl);
      const pending: (string | ArrayBuffer)[] = [];
      (ws.data as WsData & { up?: WebSocket; pending?: unknown[] }).up = up;
      (ws.data as WsData & { pending?: (string | ArrayBuffer)[] }).pending = pending;
      up.addEventListener("open", () => {
        for (const m of pending) up.send(m as string);
        pending.length = 0;
        (ws.data as WsData & { opened?: boolean }).opened = true;
      });
      up.addEventListener("message", (ev) => {
        try {
          ws.send(ev.data as string | ArrayBuffer);
        } catch {
          /* client gone */
        }
      });
      up.addEventListener("close", (ev) => {
        try {
          ws.close(ev.code, ev.reason);
        } catch {
          /* already closed */
        }
      });
      up.addEventListener("error", () => {
        try {
          ws.close(1011, "upstream error");
        } catch {
          /* already closed */
        }
      });
    },
    message(ws, message) {
      const data = ws.data as WsData & {
        up?: WebSocket;
        pending?: (string | ArrayBuffer)[];
        opened?: boolean;
      };
      const up = data.up;
      if (!up) return;
      const payload = message as string | ArrayBuffer;
      // Send directly only once the upstream is open AND its buffered frames are flushed;
      // otherwise queue, so a frame can't jump ahead of the buffered ConnectionInit and
      // break graphql-ws ordering. Cap the queue so a wedged upstream can't buffer forever.
      if (data.opened && up.readyState === WebSocket.OPEN) {
        up.send(payload as string);
      } else if (data.pending && data.pending.length < 1000) {
        data.pending.push(payload);
      } else {
        try {
          ws.close(1011, "upstream not ready");
        } catch {
          /* already closed */
        }
      }
    },
    close(ws) {
      const up = (ws.data as WsData & { up?: WebSocket }).up;
      try {
        up?.close();
      } catch {
        /* already closed */
      }
    },
  },
});

console.log(
  `[indexer-proxy] listening on http://127.0.0.1:${server.port} → ${HTTP_ORIGIN} ` +
    `(ws → ${WS_ORIGIN}); ` +
    `maxConcurrency=${LIMITS.maxConcurrency}, minInterval=${LIMITS.minIntervalMs}ms`,
);
