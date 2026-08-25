// Stop the whole anonboard stack — for real.
//
// `orchestrator stop` shuts down the orchestrator and the processes it STARTED, but it
// doesn't touch the Docker localnet or force-free anonboard's app ports. This stops the
// orchestrator, force-frees anonboard's own ports (freePorts skips Docker-held ports so
// it never nukes containers), then tears down the Docker localnet so the next boot starts
// from a fresh chain + deploy — skipped on hosted / MIDNIGHT_LOCALNET=attach.

import { spawnSync } from "node:child_process";
import { DEV_PORTS, freePorts } from "./dev-ports.ts";
import { shouldTearDownLocalnet, tearDownLocalnet } from "./localnet-teardown.ts";

// 1) ask the orchestrator to stop what it owns (best-effort).
spawnSync("bunx", ["orchestrator", "stop"], { stdio: "inherit" });

// 2) force-free anonboard's app ports (Docker-held localnet ports are skipped — see above).
const freed = freePorts(DEV_PORTS);

console.log(
  freed
    ? `\nStopped the stack and freed ${freed} leftover process(es) on anonboard ports.`
    : "\nStack stopped; all anonboard ports are free.",
);

// 3) tear down the Docker localnet (fresh chain + deploy next run).
if (shouldTearDownLocalnet()) tearDownLocalnet();
