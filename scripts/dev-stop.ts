// Stop the whole anonboard stack — for real.
//
// `orchestrator stop` shuts down the orchestrator and the processes it STARTED, but by
// design it never force-frees a localnet it merely ATTACHED to. So the Midnight node /
// indexer / proof server can survive and squat :9944 / :8088 / :6300. This asks the
// orchestrator to stop, then force-frees anonboard's ports so a clean boot follows.
//
// freePorts refuses to SIGKILL a Docker-held port: an attached localnet runs as Docker
// containers whose host ports are held by Docker's own backend, and killing that would
// take down Docker Desktop and every container — a localnet we don't own. So an attached
// (Docker) localnet is left running; stop it explicitly with `mn localnet down`. A
// self-hosted NATIVE localnet is still reaped.

import { spawnSync } from "node:child_process";
import { DEV_PORTS, freePorts } from "./dev-ports.ts";

// 1) ask the orchestrator to stop what it owns (best-effort).
spawnSync("bunx", ["orchestrator", "stop"], { stdio: "inherit" });

// 2) force-free anonboard's ports (Docker-held localnet ports are skipped — see above).
const freed = freePorts(DEV_PORTS);

console.log(
  freed
    ? `\nStopped the stack and freed ${freed} leftover process(es) on anonboard ports.`
    : "\nStack stopped; all anonboard ports are free.",
);
