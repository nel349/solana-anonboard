// Stop the whole anonboard stack — for real.
//
// `orchestrator stop` shuts down the orchestrator and the processes it STARTED, but by
// design it never force-frees a localnet it merely ATTACHED to. So the Midnight node /
// indexer / proof server can survive and squat :9944 / :8088 / :6300, which then breaks
// the next `bun run dev` with a "partial localnet" error. This asks the orchestrator to
// stop, then force-frees anonboard's fixed ports so a clean boot always follows.

import { spawnSync } from "node:child_process";

const PORTS = [9944, 8088, 6300, 8899, 9900, 9999, 3334, 3335, 5432, 5173, 4747, 30333];

// 1) ask the orchestrator to stop what it owns (best-effort).
spawnSync("bunx", ["orchestrator", "stop"], { stdio: "inherit" });

// 2) force-free anonboard's ports (reaps an attached localnet the orchestrator left).
function pidsOnPort(port: number): number[] {
  const r = spawnSync("lsof", ["-nP", `-tiTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
  return (r.stdout || "")
    .split("\n")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0 && n !== process.pid);
}

let freed = 0;
for (const port of PORTS) {
  for (const pid of pidsOnPort(port)) {
    try {
      process.kill(pid, "SIGKILL");
      freed++;
    } catch {
      /* already gone */
    }
  }
}

console.log(
  freed
    ? `\nStopped the stack and freed ${freed} leftover process(es) on anonboard ports.`
    : "\nStack stopped; all anonboard ports are free.",
);
