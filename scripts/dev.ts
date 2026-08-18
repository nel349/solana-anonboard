// A friendlier `bun run dev`.
//
// The orchestrator itself is fine, but in the foreground its status gets buried
// under the validator/sync log spam, and there's no clear "you're ready, go here"
// moment. On a cold chain the indexer also fails once and recovers, which looks
// like a crash if you can't see the status.
//
// This wrapper runs the exact same stack, but pipes the noisy logs to a file and
// shows a live doctor-checklist instead: each service turns green as it comes up,
// the indexer's one retry is labeled normal, and it ends in a clear banner telling
// you where the app is. Ctrl-C still tears the whole stack down. Raw logs live in
// .dev.log (follow with `bun run dev:logs`).

import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { DEV_PORTS } from "./dev-ports.ts";

const root = path.resolve(import.meta.dirname!, "..");
const LOG = path.join(root, ".dev.log");

const c = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", cyan: "\x1b[36m", gray: "\x1b[90m",
};
const isTTY = Boolean(process.stdout.isTTY);

type Svc = { key: string; label: string; port: number; link?: string; http?: string; note?: string; primary?: boolean };

// On a hosted net (preview/preprod) the Midnight node + indexer are remote, so only
// the local proof server is worth port-checking; on `undeployed` everything is local.
const NET = process.env.MIDNIGHT_NETWORK_ID || "undeployed";
const HOSTED = NET !== "undeployed";
const midnightRows: Svc[] = HOSTED
  ? [{ key: "proof", label: "Midnight proof server", port: 6300, note: `local; submits to ${NET} (hosted)` }]
  : [
      { key: "midnight", label: "Midnight node", port: 9944 },
      { key: "proof", label: "Midnight proof server", port: 6300 },
      { key: "indexer", label: "Midnight indexer", port: 8088, note: "may retry once on a cold chain (normal)" },
    ];
const SERVICES: Svc[] = [
  { key: "solana", label: "Solana validator", port: 8899 },
  ...midnightRows,
  { key: "sync", label: "Sync node API", port: 9999, http: "http://localhost:9999/api/posts", link: "http://localhost:9999/api/posts" },
  { key: "operator", label: "Operator", port: 3335, link: "http://localhost:3335" },
  { key: "batcher", label: "Batcher", port: 3334, link: "http://localhost:3334" },
  { key: "frontend", label: "Frontend", port: 5173, link: "http://localhost:5173", primary: true },
];

function tcpOpen(port: number, timeout = 700): Promise<boolean> {
  return new Promise((res) => {
    const s = net.connect({ host: "127.0.0.1", port });
    let done = false;
    const fin = (v: boolean) => { if (!done) { done = true; s.destroy(); res(v); } };
    s.once("connect", () => fin(true));
    s.once("error", () => fin(false));
    s.setTimeout(timeout, () => fin(false));
  });
}
async function httpOk(url: string, timeout = 900): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    return r.ok;
  } catch { return false; }
}
async function isUp(s: Svc): Promise<boolean> {
  if (!(await tcpOpen(s.port))) return false;
  return s.http ? httpOk(s.http) : true;
}

// ── start the real stack, logs to file ──────────────────────────────────────
fs.writeFileSync(LOG, "");
const logStream = fs.createWriteStream(LOG, { flags: "a" });
let logTail = "";
function capture(buf: Buffer) {
  logStream.write(buf);
  logTail = (logTail + buf.toString()).slice(-20000);
}
const child = spawn("bunx", ["orchestrator", "start"], {
  cwd: root,
  env: { ...process.env, NODE_ENV: "development" },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", capture);
child.stderr.on("data", capture);

let stopping = false;
function freePorts(): number {
  let n = 0;
  for (const port of DEV_PORTS) {
    const r = spawnSync("lsof", ["-nP", `-tiTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    for (const pid of (r.stdout || "")
      .split("\n")
      .map((s) => parseInt(s.trim(), 10))
      .filter((x) => Number.isInteger(x) && x > 0 && x !== process.pid)) {
      try { process.kill(pid, "SIGKILL"); n++; } catch { /* already gone */ }
    }
  }
  return n;
}
// Ctrl-C always fully stops the stack — kill what we started, then force-free the
// ports (reaps an attached localnet the orchestrator won't). Same in both modes.
function teardown() {
  if (stopping) return;
  stopping = true;
  process.stdout.write(`\n${c.dim}stopping the stack…${c.reset}\n`);
  if (child.exitCode === null) { try { child.kill("SIGTERM"); } catch { /* gone */ } }
  setTimeout(() => {
    const n = freePorts();
    process.stdout.write(`${c.dim}stopped${n ? ` (freed ${n} leftover)` : ""}.${c.reset}\n`);
    process.exit(0);
  }, 1500);
}
process.on("SIGINT", teardown);
process.on("SIGTERM", teardown);
child.on("exit", (code) => {
  if (stopping) return; // teardown() will exit
  // The orchestrator returns (rather than staying foreground) when it attached to an
  // already-running localnet. Keep holding the terminal anyway, so `bun run dev` behaves
  // the same in both modes — foreground, and Ctrl-C stops everything.
  if (ready && (code ?? 0) === 0) {
    process.stdout.write(`${c.dim}(attached to a running localnet — holding here; Ctrl-C stops the stack)${c.reset}\n`);
    setInterval(() => {}, 60_000); // keep the event loop alive
    return;
  }
  if (code) {
    process.stdout.write(
      `\n${c.red}The stack exited early (code ${code}).${c.reset} Last logs:\n` +
      `${c.dim}${logTail.split("\n").slice(-14).join("\n")}${c.reset}\n` +
      `Full logs: ${c.cyan}.dev.log${c.reset}\n`,
    );
  }
  process.exit(code ?? 0);
});

// ── deploy phase (the long pole: waits on dust) inferred from the log ────────
function deployStatus(syncUp: boolean): { mark: string; note: string } {
  if (syncUp || /Deployment successful/.test(logTail)) return { mark: "up", note: "" };
  if (/Waiting to receive tokens/.test(logTail)) return { mark: "retry", note: "waiting for dust (~1-2 min, normal)" };
  return { mark: "wait", note: "" };
}

const MARK: Record<string, string> = {
  up: `${c.green}✓${c.reset}`,
  retry: `${c.yellow}⟳${c.reset}`,
  wait: `${c.gray}·${c.reset}`,
};
function pad(s: string, n: number) { return s + " ".repeat(Math.max(0, n - s.length)); }

const started = Date.now();
let lastLines = 0;
let ready = false;

function render(states: Record<string, boolean>) {
  const elapsed = Math.floor((Date.now() - started) / 1000);
  const lines: string[] = [];
  lines.push(`${c.bold}Starting anonboard localnet${c.reset}  ${c.dim}(${elapsed}s · logs → .dev.log)${c.reset}`);
  lines.push("");
  const row = (mark: string, label: string, right: string, note?: string) =>
    `  ${MARK[mark] ?? "·"} ${pad(label, 24)}${c.dim}${pad(right, 34)}${c.reset}` +
    (note ? `${c.dim}${note}${c.reset}` : "");

  for (const s of SERVICES) {
    if (s.key === "sync") {
      const d = deployStatus(states.sync);
      lines.push(row(d.mark, "Contract deploy", "", d.note));
    }
    const up = states[s.key];
    const mark = up ? "up"
      : s.key === "indexer" && /spo-indexer exited with ERROR/.test(logTail) ? "retry"
      : "wait";
    lines.push(row(mark, s.label, s.link ?? `:${s.port}`, up ? "" : s.note ?? ""));
  }

  const block = lines.join("\n") + "\n";
  if (isTTY) {
    if (lastLines) process.stdout.write(`\x1b[${lastLines}A\x1b[0J`);
    process.stdout.write(block);
    lastLines = lines.length;
  } else {
    // non-TTY: only print when something changed (avoid spam)
    process.stdout.write(block + "\n");
  }
}

function banner() {
  const line = (label: string, url: string, tail = "") =>
    `  ${c.dim}${pad(label, 10)}${c.reset}${c.cyan}${url}${c.reset}${tail ? `  ${c.dim}${tail}${c.reset}` : ""}`;
  process.stdout.write(
    `\n${c.green}${c.bold}✓ anonboard is ready${c.reset}\n\n` +
    line("Open", "http://localhost:5173", "← the app") + "\n" +
    line("Sync API", "http://localhost:9999/api/posts") + "\n" +
    line("Operator", "http://localhost:3335") + "\n" +
    line("Batcher", "http://localhost:3334") + "\n" +
    `  ${c.dim}${pad("Chain", 10)}${c.reset}${c.dim}${HOSTED ? `Midnight ${NET} (hosted) · proof :6300` : "Midnight :9944 / :8088 / :6300"}   Solana :8899${c.reset}\n\n` +
    `  ${c.dim}logs:${c.reset} bun run dev:logs   ${c.dim}status:${c.reset} bun run dev:status   ${c.dim}stop:${c.reset} Ctrl-C  ${c.dim}(or bun run dev:stop)${c.reset}\n\n`,
  );
}

async function loop() {
  const results = await Promise.all(SERVICES.map(isUp));
  const states: Record<string, boolean> = {};
  SERVICES.forEach((s, i) => (states[s.key] = results[i]));

  if (!ready) render(states);

  const allUp = SERVICES.every((s) => states[s.key]);
  if (allUp && !ready) {
    ready = true;
    banner();
    return; // stop polling; the child keeps the stack alive, Ctrl-C tears it down
  }
  if (!stopping) setTimeout(loop, 1200);
}

process.stdout.write(`${c.dim}booting… first cold start downloads toolchains and waits on dust; give it a few minutes.${c.reset}\n\n`);
void loop();
