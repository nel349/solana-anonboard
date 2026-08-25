// The fixed ports anonboard's dev stack touches, plus the one safe way to force-free
// them. Shared by the dev wrapper (scripts/dev.ts) and the teardown (scripts/dev-stop.ts)
// so "stop" behaves identically everywhere.

import { spawnSync } from "node:child_process";

// Ports bound by anonboard's OWN native processes. Always safe to force-free on stop —
// these are processes we started and exclusively own.
export const APP_PORTS = [
  8079, // Midnight indexer rate-limiting proxy (hosted nets)
  8899, 9900, // Solana validator
  8898, // Solana devnet post reader (health)
  5432, // PGLite
  9999, // sync node API
  3334, 3335, // batcher / operator
  5173, // frontend
  4747, // orchestrator API
];

// The Midnight localnet ports. anonboard's localnet is mn's Docker localnet, so these
// published host ports are held by Docker's own backend process. SIGKILLing that backend
// kills Docker Desktop and every container. freePorts() never kills a Docker-held port,
// so the localnet survives a plain freePorts; it's torn down explicitly with
// `mn localnet down` (see scripts/localnet-teardown.ts).
export const LOCALNET_PORTS = [
  9944, 30333, // Midnight node / p2p
  8088, // Midnight indexer
  6300, // Midnight proof server
];

// Back-compat union (the full set anonboard interacts with).
export const DEV_PORTS = [...APP_PORTS, ...LOCALNET_PORTS];

// Holders we must never SIGKILL: Docker's backend/proxy holds the published host port of
// an attached Docker localnet (and of Docker Desktop itself). Killing it takes down every
// container. Match the process names lsof reports for the Docker/VM networking layer.
const PROTECTED_COMMAND = /^(com\.docke|Docker|dockerd|docker-|vpnkit|qemu|colima|lima)/i;

export function isProtectedCommand(command: string): boolean {
  return PROTECTED_COMMAND.test(command);
}

type PortHolder = { pid: number; command: string };

// Listening PID(s) + command name for a port, via one lsof -F call (p<pid>, c<command>).
function holdersOnPort(port: number): PortHolder[] {
  const r = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"], {
    encoding: "utf8",
  });
  const holders: PortHolder[] = [];
  let cur: Partial<PortHolder> = {};
  for (const line of (r.stdout || "").split("\n")) {
    if (line.startsWith("p")) {
      if (cur.pid) holders.push(cur as PortHolder);
      cur = { pid: parseInt(line.slice(1), 10) };
    } else if (line.startsWith("c")) {
      cur.command = line.slice(1);
    }
  }
  if (cur.pid) holders.push(cur as PortHolder);
  return holders.filter(
    (h): h is PortHolder => Number.isInteger(h.pid) && h.pid > 0 && typeof h.command === "string",
  );
}

// Force-free the given ports by SIGKILLing their listeners — but NEVER a Docker/VM
// process (that would kill an attached Docker localnet and Docker Desktop itself) and
// never this process. Returns the number of processes killed.
export function freePorts(ports: number[]): number {
  let killed = 0;
  for (const port of ports) {
    for (const h of holdersOnPort(port)) {
      if (h.pid === process.pid) continue;
      if (isProtectedCommand(h.command)) continue; // leave Docker (and its containers) alone
      try {
        process.kill(h.pid, "SIGKILL");
        killed++;
      } catch {
        /* already gone */
      }
    }
  }
  return killed;
}
