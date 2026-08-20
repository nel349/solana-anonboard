// Shared fast-dust prime via the linked `mn` CLI (midnight-wallet-cli). Both the
// operator (roster fee-payer) and the contract deploy build a Midnight wallet that
// must spend dust; the SDK's own cold dust scan takes minutes on a hosted net and
// on preprod never completes ("could not balance dust"). `mn dust export` reads dust
// via the indexer-direct collapsed fast-sync (only our events) and emits a
// facade-restorable snapshot — ~5-15s — which we hand to buildWalletFacade as
// `dustSerializedState` so the facade resumes warm instead of cold-syncing.
import { spawn } from "node:child_process";
import path from "node:path";

// The linked midnight-wallet-cli binary. Same relative depth from this file
// (packages/contracts-midnight/) as from packages/operator/: repo-root/node_modules.
const MN_BIN = path.resolve(import.meta.dirname!, "../../node_modules/.bin/mn");

// Run `mn` and capture stdout, with a hard timeout. Rejects on non-zero exit,
// spawn error (e.g. mn not linked), or timeout — callers treat any rejection as
// "fall back to the SDK cold sync". `extraEnv` passes secrets (the seed) via the
// child's environment instead of argv, so `ps` can't expose them.
export function runMn(args: string[], timeoutMs: number, extraEnv?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(MN_BIN, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`mn timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      // Keep more stderr than a one-liner: mn prints polkadot dedup noise before
      // the real error, so a 200-char tail can hide the actual message.
      else reject(new Error(`mn exited ${code}: ${stderr.trim().slice(-600)}`));
    });
  });
}

// Pre-sync dust via mn's fast indexer-direct reader and return a facade-restorable
// dust snapshot (dustSerializedState). Best-effort — throws on any failure so the
// caller can fall back to the SDK cold sync.
export async function primeDustSnapshotViaMn(
  network: string,
  seed: string,
  opts?: { log?: (msg: string) => void; timeoutMs?: number },
): Promise<string> {
  const log = opts?.log ?? (() => {});
  const timeoutMs = opts?.timeoutMs ?? 150_000;
  const t0 = Date.now();
  log("priming dust via mn (fast indexer-direct sync)…");
  // Seed goes via MN_SEED in the child env (not argv) so it never appears in `ps`.
  const raw = await runMn(["dust", "export", "--network", network, "--json"], timeoutMs, { MN_SEED: seed });
  const i = raw.indexOf("{");
  const j = raw.lastIndexOf("}");
  if (i < 0 || j < 0) throw new Error("mn dust export produced no JSON");
  const parsed = JSON.parse(raw.slice(i, j + 1)) as { snapshot?: string; offset?: number; dustBalance?: string };
  if (!parsed.snapshot) throw new Error("mn dust export returned no snapshot");
  log(`dust primed via mn: offset=${parsed.offset} balance=${parsed.dustBalance} (${Math.round((Date.now() - t0) / 1000)}s)`);
  return parsed.snapshot;
}
