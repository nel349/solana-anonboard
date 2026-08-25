// Preflight for the Midnight localnet group (node 9944 / indexer 8088 / proof 6300).
// anonboard's local Midnight chain IS mn's Docker localnet (`mn localnet up`). This
// module decides whether `bun run dev` / the E2E should bring that localnet up itself
// ("docker", the default) or use one already running ("attach"), and it exports the
// readiness + identity probes that scripts/midnight-localnet-up.ts reuses.
//
// (Solana + PGLite are anonboard's own and never shared, so they always self-host —
// this preflight only governs Midnight.)

import { spawnSync } from "node:child_process";

export const NODE_RPC = "http://127.0.0.1:9944";
export const INDEXER = "http://127.0.0.1:8088";
export const INDEXER_GRAPHQL = `${INDEXER}/api/v4/graphql`; // v4 on every net (networks.ts)
export const PROOF = "http://127.0.0.1:6300";

function curl(args: string[]): string {
  const r = spawnSync("curl", args, { encoding: "utf8", timeout: 6000 });
  return r.stdout ?? "";
}

// "000" http_code = nothing accepted the connection.
export function httpResponds(url: string): boolean {
  const code = curl(["-s", "-m", "2", "-o", "/dev/null", "-w", "%{http_code}", url]).trim();
  return code !== "" && code !== "000";
}

// A real Midnight/Substrate node answers system_health with a `result`.
export function nodeHealthy(): boolean {
  const body = curl([
    "-s", "-m", "3", NODE_RPC,
    "-H", "content-type: application/json",
    "-d", '{"jsonrpc":"2.0","id":1,"method":"system_health","params":[]}',
  ]);
  return body.includes('"result"');
}

// The indexer answers a trivial GraphQL query at the v4 endpoint anonboard uses.
export function indexerHealthy(): boolean {
  const body = curl([
    "-s", "-m", "3", INDEXER_GRAPHQL,
    "-H", "content-type: application/json",
    "-d", '{"query":"{ __typename }"}',
  ]);
  return body.includes('"data"');
}

// The chain-spec name via system_chain (mn's undeployed localnet reports "undeployed1").
// Used to refuse a DIFFERENT network squatting the ports (preprod/preview) — a silent
// use there would break address formats (HRP mismatch) and dust. null if unreadable.
export function nodeChainName(): string | null {
  const body = curl([
    "-s", "-m", "3", NODE_RPC,
    "-H", "content-type: application/json",
    "-d", '{"jsonrpc":"2.0","id":1,"method":"system_chain","params":[]}',
  ]);
  const m = body.match(/"result"\s*:\s*"([^"]*)"/);
  return m ? m[1] : null;
}

// anonboard targets the `undeployed` network; any chain whose name doesn't mention it
// is treated as incompatible.
export function isUndeployedChain(name: string): boolean {
  return /undeployed/i.test(name);
}

export type MidnightPlan = { mode: "docker" | "attach"; reason: string };

// One way: mn's Docker localnet. Default `docker` brings it up via `mn localnet up`
// (idempotent — a no-op when it's already healthy), done by scripts/midnight-localnet-up.ts,
// which also enforces readiness + the undeployed chain-name gate. MIDNIGHT_LOCALNET=attach
// skips the bring-up to use a localnet managed elsewhere (e.g. CI).
export function midnightPlan(): MidnightPlan {
  const forced = (process.env.MIDNIGHT_LOCALNET ?? "auto").toLowerCase();
  if (forced === "attach")
    return { mode: "attach", reason: "forced by MIDNIGHT_LOCALNET=attach — using an already-running localnet" };
  return { mode: "docker", reason: "mn Docker localnet (`mn localnet up`)" };
}
