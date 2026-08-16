// Restart-on-failure supervisor for a single long-running bun process.
//
// Why this exists: the vendored Midnight indexer (indexer-standalone 4.3.3)
// bundles an spo-indexer that, on a freshly-wiped chain, can crash the whole
// indexer from process_next_epoch (a parse error the wrapper's block-#1 startup
// guard doesn't cover). It's a startup race — the chain just hasn't advanced far
// enough yet — so relaunching a few seconds later succeeds. The Docker localnet
// handles the same indexer version with `restart: on-failure`; the EffectStream
// orchestrator's ProcessConfig has no restart field, so we supervise the process
// ourselves. See docs/internal/LOCALNET-DESIGN.md.
//
// Usage (from an orchestrator ProcessConfig): keep the original command's args
// and prepend this script, e.g.
//   args: ["run", "<abs>/scripts/restart-on-failure.ts", "run", "midnight-indexer:start"]
// It re-runs `bun <args-after-this-script>` in the inherited cwd/env, restarting
// on any non-zero/ signal exit until the process stays up. A clean exit (code 0)
// is passed through and NOT restarted, and a shutdown signal is forwarded to the
// child so the orchestrator can stop it normally.

import { spawn, type ChildProcess } from "node:child_process";

const MAX_RESTARTS = Number(process.env.RESTART_ON_FAILURE_MAX ?? "10");
const BACKOFF_MS = Number(process.env.RESTART_ON_FAILURE_BACKOFF_MS ?? "2000");

// Everything after this script's path is the command to run under this same bun.
const childArgs = process.argv.slice(2);
if (childArgs.length === 0) {
  console.error("[restart-on-failure] no command given to supervise");
  process.exit(2);
}

const label = childArgs.join(" ");
let shuttingDown = false;
let child: ChildProcess | null = null;

function forward(signal: NodeJS.Signals): void {
  shuttingDown = true;
  if (child && child.exitCode === null) child.kill(signal);
}
process.on("SIGTERM", () => forward("SIGTERM"));
process.on("SIGINT", () => forward("SIGINT"));

function runOnce(): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    child = spawn(process.execPath, childArgs, { stdio: "inherit" });
    child.on("exit", (code, signal) => resolve({ code, signal }));
    child.on("error", (err) => {
      console.error(`[restart-on-failure] failed to spawn \`${label}\`:`, err);
      resolve({ code: 1, signal: null });
    });
  });
}

async function main(): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RESTARTS; attempt++) {
    const { code, signal } = await runOnce();

    if (shuttingDown) process.exit(code ?? 0);
    if (code === 0) process.exit(0);

    if (attempt === MAX_RESTARTS) {
      console.error(
        `[restart-on-failure] \`${label}\` still failing after ${MAX_RESTARTS} restarts (last ${signal ? `signal ${signal}` : `code ${code}`}) — giving up.`,
      );
      process.exit(code ?? 1);
    }

    console.warn(
      `[restart-on-failure] \`${label}\` exited (${signal ? `signal ${signal}` : `code ${code}`}); restart ${attempt + 1}/${MAX_RESTARTS} in ${BACKOFF_MS}ms…`,
    );
    await new Promise((r) => setTimeout(r, BACKOFF_MS));
  }
}

main();
