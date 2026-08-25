// Bring up (or attach to) anonboard's local Midnight chain — mn's Docker localnet.
//
// `mn localnet up` is idempotent: it starts the node/indexer/proof containers on
// 9944/8088/6300, or no-ops when they're already healthy. Its exit code is unreliable
// (mn downgrades some failures to warnings), so we don't trust it — we poll the same
// readiness probes anonboard uses everywhere (localnet-preflight.ts) until all three
// answer, then confirm the chain is `undeployed` so we never build against a foreign
// chain (preprod/preview) that happens to be squatting the ports. Exit 0 when ready,
// exit 1 on timeout / wrong chain — its `critical:true` in start.dev.ts aborts the boot
// with a clear message rather than letting the deploy spin.

import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  nodeHealthy,
  indexerHealthy,
  httpResponds,
  nodeChainName,
  isUndeployedChain,
  PROOF,
} from "../localnet-preflight.ts";

const MN = path.resolve(import.meta.dirname!, "..", "node_modules/.bin/mn");
const UP_TIMEOUT_MS = 300_000; // `mn localnet up` — generous, first run pulls images
const READY_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 3_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function localnetUp(): void {
  console.log("[midnight-localnet-up] bringing up mn's Docker localnet (`mn localnet up`)…");
  console.log("[midnight-localnet-up] first run pulls the node/indexer/proof images — this can take a few minutes.");
  // stdio:inherit so the image pull + mn's progress stream through; a 5-min cap covers
  // a cold pull. A non-zero status is only logged — readiness polling below is the real
  // gate (mn's exit code is unreliable).
  const r = spawnSync(MN, ["localnet", "up"], { stdio: "inherit", timeout: UP_TIMEOUT_MS });
  if (r.status !== 0)
    console.log(`[midnight-localnet-up] \`mn localnet up\` exited ${r.status ?? "on timeout/signal"} — verifying readiness directly.`);
}

async function waitForReady(): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastState = "";
  while (Date.now() < deadline) {
    const node = nodeHealthy();
    const indexer = indexerHealthy();
    const proof = httpResponds(PROOF);
    if (node && indexer && proof) return true;
    const state = `node ${node ? "up" : "…"}, indexer ${indexer ? "up" : "…"}, proof ${proof ? "up" : "…"}`;
    if (state !== lastState) {
      console.log(`[midnight-localnet-up] waiting for readiness — ${state}`);
      lastState = state;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

async function main(): Promise<void> {
  if (spawnSync(MN, ["--version"], { encoding: "utf8" }).status !== 0) {
    console.error(
      "[midnight-localnet-up] `mn` (midnight-wallet-cli) not found — it's a project dependency; run `bun install`.",
    );
    process.exit(1);
  }

  localnetUp();

  if (!(await waitForReady())) {
    console.error(
      [
        "",
        `[midnight-localnet-up] localnet not healthy after ${READY_TIMEOUT_MS / 1000}s.`,
        "Check Docker is running and the images pulled: `mn localnet status`, `mn localnet logs`.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  // Guard against a foreign chain on the ports (a preprod/preview localnet) — building
  // against it would break address formats (HRP mismatch) and dust.
  const chain = nodeChainName();
  if (chain && !isUndeployedChain(chain)) {
    console.error(
      [
        "",
        `[midnight-localnet-up] the localnet on 9944/8088/6300 is the '${chain}' chain; anonboard needs 'undeployed'.`,
        "Stop that localnet (`mn localnet down`) and re-run, or point anonboard at a compatible chain.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  console.log(
    `[midnight-localnet-up] localnet ready — node/indexer/proof healthy on 9944/8088/6300 (chain '${chain ?? "undeployed"}').`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[midnight-localnet-up] unexpected error:", err);
  process.exit(1);
});
