// Smart localnet preflight for the Midnight group (node 9944 / indexer 8088 /
// proof 6300). Decides whether to SELF-HOST a fresh localnet or ATTACH to one
// that's already running — and NEVER force-frees a shared port. Runs
// synchronously at config-load so start.dev.ts / start.test.ts can build the
// Midnight leg from the plan. See docs/internal/LOCALNET-DESIGN.md.
//
// (Solana + PGLite are anonboard's own and never shared, so they always
// self-host — this preflight only governs Midnight.)

import { spawnSync } from "node:child_process";

const NODE_RPC = "http://127.0.0.1:9944";
const INDEXER = "http://127.0.0.1:8088";
const PROOF = "http://127.0.0.1:6300";

function curl(args: string[]): string {
  const r = spawnSync("curl", args, { encoding: "utf8", timeout: 6000 });
  return r.stdout ?? "";
}

// "000" http_code = nothing accepted the connection.
function httpResponds(url: string): boolean {
  const code = curl(["-s", "-m", "2", "-o", "/dev/null", "-w", "%{http_code}", url]).trim();
  return code !== "" && code !== "000";
}

// A real Midnight/Substrate node answers system_health with a `result`.
function nodeHealthy(): boolean {
  const body = curl([
    "-s", "-m", "3", NODE_RPC,
    "-H", "content-type: application/json",
    "-d", '{"jsonrpc":"2.0","id":1,"method":"system_health","params":[]}',
  ]);
  return body.includes('"result"');
}

export type MidnightPlan = { mode: "self-host" | "attach"; reason: string };

export function midnightPlan(): MidnightPlan {
  const forced = (process.env.MIDNIGHT_LOCALNET ?? "auto").toLowerCase();
  if (forced === "self")
    return { mode: "self-host", reason: "forced by MIDNIGHT_LOCALNET=self" };
  if (forced === "attach")
    return { mode: "attach", reason: "forced by MIDNIGHT_LOCALNET=attach" };

  const node = nodeHealthy();
  const indexer = httpResponds(INDEXER);
  const proof = httpResponds(PROOF);
  const upCount = [node, indexer, proof].filter(Boolean).length;

  if (upCount === 0)
    return { mode: "self-host", reason: "no Midnight localnet detected — starting a fresh one" };

  if (node && indexer && proof)
    return {
      mode: "attach",
      reason: "healthy Midnight localnet already on 9944/8088/6300 — attaching (not restarting it)",
    };

  // Partial / unhealthy — never kill a shared port. Stop with guidance.
  const state = `node ${node ? "up" : "DOWN"}, indexer ${indexer ? "up" : "DOWN"}, proof ${proof ? "up" : "DOWN"}`;
  throw new Error(
    [
      "",
      "A partial/unhealthy Midnight localnet is on ports 9944/8088/6300:",
      `    ${state}`,
      "",
      "anonboard won't force-free those ports — they may be a localnet you're using.",
      "Do one of:",
      "  • bring that localnet fully up (all three healthy) → anonboard will attach; or",
      "  • stop it and free the ports, then re-run → a fresh localnet starts; or",
      "  • MIDNIGHT_LOCALNET=self bun run dev   (start fresh — only once the ports are free).",
      "",
    ].join("\n"),
  );
}
