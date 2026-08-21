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
import { stripAnsi, deployStep, clampWidth } from "./dev-render.ts";
import { getDeployment } from "../packages/contracts-midnight/deployments.ts";
import { DEVNET_RPC, DEVNET_BATCHER_KEYPAIR, provisionDevnet } from "./provision-devnet.ts";
import { SOLANA_DEVNET_PROGRAM_ID } from "../packages/contracts-solana/devnet.ts";
import readline from "node:readline/promises";
import { Keypair } from "@solana/web3.js";

const root = path.resolve(import.meta.dirname!, "..");
const LOG = path.join(root, ".dev.log");

const c = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", cyan: "\x1b[36m", gray: "\x1b[90m",
};
const isTTY = Boolean(process.stdout.isTTY);

// `blocking: false` = the ready banner does NOT wait on this service; it shows as "warming"
// and flips to "Join enabled" in place when it comes up. Used for the operator on hosted
// nets: it's only needed to JOIN, and its dust sync shouldn't delay "ready to post".
type Svc = { key: string; label: string; port: number; link?: string; http?: string; note?: string; primary?: boolean; blocking?: boolean };

// On a hosted net (preview/preprod) the Midnight node + indexer are remote, so only
// the local proof server is worth port-checking; on `undeployed` everything is local.
const NET = process.env.MIDNIGHT_NETWORK_ID || "undeployed";
const HOSTED = NET !== "undeployed";
const midnightRows: Svc[] = HOSTED
  ? [
      { key: "proof", label: "Midnight proof server", port: 6300, note: `local; submits to ${NET} (hosted)` },
      { key: "indexerProxy", label: "Indexer rate-limit proxy", port: 8079, note: `local; smooths requests to ${NET}` },
    ]
  : [
      { key: "midnight", label: "Midnight node", port: 9944 },
      { key: "proof", label: "Midnight proof server", port: 6300 },
      { key: "indexer", label: "Midnight indexer", port: 8088, note: "may retry once on a cold chain (normal)" },
    ];
const SERVICES: Svc[] = [
  { key: "solana", label: "Solana validator", port: 8899 },
  ...midnightRows,
  { key: "sync", label: "Sync node API", port: 9999, http: "http://localhost:9999/api/posts", link: "http://localhost:9999/api/posts", note: HOSTED ? `catching up ${NET} badges (posts work once it's up)` : undefined },
  // The operator binds its port immediately but then warms up (builds the wallet,
  // syncs dust, finds the contract). Gate its ✓ on /health (200 only when ready),
  // not just the open port, so the ready banner never fires while a join would still
  // get "operator warming up".
  { key: "operator", label: "Operator", port: 3335, http: "http://localhost:3335/health", link: "http://localhost:3335", note: HOSTED ? "warming — join enabled once dust syncs (~1 min); posting works now" : "warming up…", blocking: !HOSTED },
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
async function httpOk(url: string, timeout = 2500): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    return r.ok;
  } catch { return false; }
}

// Reuse-or-redeploy prompt. Blocks the boot because the answer has to be known before
// the deploy step runs. Interactive terminals only; auto-reuses after 20s so it never
// hangs. "n" sets ANONBOARD_REDEPLOY, which start.dev.ts forwards to the deploy step.
async function maybePromptRedeploy(): Promise<void> {
  if (!isTTY) return;
  const existing = getDeployment(NET);
  if (!existing) return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const when = existing.deployedAt ? `, deployed ${existing.deployedAt.slice(0, 10)}` : "";
  const answer = (
    await Promise.race([
      rl.question(
        `\n${c.bold}Contract already deployed on ${NET}${c.reset}: ` +
          `${c.cyan}${existing.contractAddress.slice(0, 16)}…${c.reset} ` +
          `${c.dim}(block ${existing.deployBlock}${when})${c.reset}\n` +
          `Reuse it? ${c.dim}[Y/n]  Enter reuses · n redeploys · auto-reuse in 20s${c.reset} `,
      ),
      new Promise<string>((res) => setTimeout(() => res(""), 20_000)),
    ])
  )
    .trim()
    .toLowerCase();
  rl.close();
  if (answer === "n" || answer === "no" || answer === "redeploy") {
    process.env.ANONBOARD_REDEPLOY = "1";
    process.stdout.write(`${c.yellow}→ redeploying a fresh contract on ${NET}.${c.reset}\n`);
  } else {
    process.stdout.write(`${c.dim}→ reusing the existing contract on ${NET}.${c.reset}\n`);
  }
}
await maybePromptRedeploy();

// Solana network: the local validator is ephemeral (posts reset every run); devnet is
// hosted, so posts persist across restarts. SOLANA_NETWORK env pre-empts the prompt;
// non-interactive shells default to local. Resolves the RPC and exports it to the
// orchestrator (SOLANA_RPC_URL for node services, VITE_SOLANA_RPC_URL for the frontend).
// On devnet a standalone post-reader (this health port) folds Solana posts for the sync;
// batcher/frontend/provision talk to devnet directly.
const SOLANA_READER_PORT = 8898;
let solanaReaderPort: number | null = null; // set when devnet is chosen; drives the checklist row
const LOCAL_RPC = "http://localhost:8899";
// Local batcher/sponsor keypair — generated on first run, NOT committed (each clone gets its
// own). An existing key is reused, so a working local setup is left untouched.
const LOCAL_BATCHER_KEYPAIR = path.join(root, "packages/batcher/keypair/batcher-wallet.json");
function loadOrCreateLocalBatcher(): string {
  if (!fs.existsSync(LOCAL_BATCHER_KEYPAIR)) {
    fs.mkdirSync(path.dirname(LOCAL_BATCHER_KEYPAIR), { recursive: true });
    const kp = Keypair.generate();
    fs.writeFileSync(LOCAL_BATCHER_KEYPAIR, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
    return kp.publicKey.toBase58();
  }
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(LOCAL_BATCHER_KEYPAIR, "utf8"))),
  ).publicKey.toBase58();
}
async function maybePromptSolanaNetwork(): Promise<void> {
  let choice = (process.env.SOLANA_NETWORK ?? "").toLowerCase();
  if (choice !== "local" && choice !== "devnet" && isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = (
      await Promise.race([
        rl.question(
          `\n${c.bold}Solana network?${c.reset} ` +
            `${c.dim}[L]ocal validator (posts reset each run) · [d]evnet (hosted, posts persist) · auto-local in 20s${c.reset} `,
        ),
        new Promise<string>((res) => setTimeout(() => res(""), 20_000)),
      ])
    )
      .trim()
      .toLowerCase();
    rl.close();
    choice = answer === "d" || answer === "devnet" ? "devnet" : "local";
  }
  choice = choice === "devnet" ? "devnet" : "local";
  process.env.SOLANA_NETWORK = choice;
  const rpc = process.env.SOLANA_RPC_URL || (choice === "devnet" ? DEVNET_RPC : LOCAL_RPC);
  process.env.SOLANA_RPC_URL = rpc;
  process.env.VITE_SOLANA_RPC_URL = rpc;

  if (choice !== "devnet") {
    // Generate a local batcher/sponsor keypair on first run (not committed) and inject its pubkey
    // so the frontend + gasless path use it — mirrors the devnet path. An existing key is reused.
    const feePayer = loadOrCreateLocalBatcher();
    process.env.SOLANA_BATCHER_KEYPAIR = LOCAL_BATCHER_KEYPAIR;
    process.env.VITE_BATCHER_FEE_PAYER = feePayer;
    process.stdout.write(
      `${c.dim}→ Solana on the local validator (posts reset each run). batcher ${feePayer.slice(0, 8)}…${c.reset}\n`,
    );
    return;
  }

  // Provision the shared devnet program + a funded fee-payer, then export the resolved
  // values so every service (frontend, batcher, sync) targets devnet.
  process.stdout.write(`${c.yellow}→ Solana on devnet — provisioning (fund fee-payer + reuse the shared program)…${c.reset}\n`);
  const { feePayer } = await provisionDevnet((m) =>
    process.stdout.write(`${c.dim}${m}${c.reset}\n`),
  );
  process.env.POST_PROGRAM_ID = SOLANA_DEVNET_PROGRAM_ID;
  process.env.VITE_POST_PROGRAM_ID = SOLANA_DEVNET_PROGRAM_ID;
  process.env.VITE_BATCHER_FEE_PAYER = feePayer;
  process.env.SOLANA_BATCHER_KEYPAIR = DEVNET_BATCHER_KEYPAIR;
  // On devnet the SDK's Solana leg is off (it can't getBlock); the standalone solana-post-reader
  // lists posts via getProgramAccounts (current state — no start slot needed). Point it at devnet
  // + the shared program. Batcher/frontend/provision talk to devnet directly.
  process.env.SOLANA_READER_UPSTREAM = rpc;
  process.env.SOLANA_READER_PROGRAM_ID = SOLANA_DEVNET_PROGRAM_ID;
  process.env.SOLANA_READER_PORT = String(SOLANA_READER_PORT);
  solanaReaderPort = SOLANA_READER_PORT;
  process.stdout.write(
    `${c.yellow}→ devnet ready — program ${SOLANA_DEVNET_PROGRAM_ID.slice(0, 8)}…, posts persist across restarts.${c.reset}\n`,
  );
}
await maybePromptSolanaNetwork();

// Reusing a recorded contract means the deploy step is a no-op, so its checklist row
// shouldn't wait on the sync node — mark it done immediately.
const reusingContract = Boolean(getDeployment(NET)) && !process.env.ANONBOARD_REDEPLOY;

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
// Show the deploy's *current* step (building wallet, syncing dust with progress,
// submitting) rather than a flat "working…", read from the deploy process's log.
function deployStatus(syncUp: boolean): { mark: string; note: string } {
  if (reusingContract || syncUp || /Deployment successful/.test(logTail)) return { mark: "up", note: "" };
  const step = deployStep(logTail);
  return step ? { mark: "retry", note: step } : { mark: "wait", note: "" };
}

const MARK = {
  up: `${c.green}✓${c.reset}`,
  wait: `${c.gray}·${c.reset}`,
};
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
function pad(s: string, n: number) { return s + " ".repeat(Math.max(0, n - s.length)); }
// The latest meaningful log line, shown live so a slow step reads as "working", not frozen.
// Skip blank lines and bare "[process]" tag lines (which carry no message).
function lastActivity(): string {
  const lines = stripAnsi(logTail)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^\[[^\]]+\]$/.test(l));
  const last = lines[lines.length - 1] ?? "";
  return last.length > 92 ? last.slice(0, 92) + "…" : last;
}

const started = Date.now();
let lastLines = 0;
let ready = false;
let frame = 0;
let states: Record<string, boolean> = {};

type Row = { label: string; right: string; status: "up" | "retry" | "wait"; note?: string };
function rows(): Row[] {
  const out: Row[] = [];
  for (const s of SERVICES) {
    if (s.key === "sync") {
      const d = deployStatus(states.sync);
      out.push({ label: reusingContract ? "Contract deploy (reused)" : "Contract deploy", right: "", status: d.mark as Row["status"], note: d.note });
    }
    const up = states[s.key];
    const status: Row["status"] = up ? "up"
      : s.key === "indexer" && /spo-indexer exited with ERROR/.test(logTail) ? "retry" : "wait";
    const devnetSolana = s.key === "solana" && solanaReaderPort;
    out.push({
      label: devnetSolana ? "Solana devnet" : s.label,
      right: devnetSolana ? `:${solanaReaderPort}` : (s.link ?? `:${s.port}`),
      status,
      note: up ? "" : devnetSolana ? "devnet post reader; posts persist across restarts" : s.note,
    });
  }
  return out;
}

// The in-progress checklist (pre-ready). Returns the lines; render() owns the draw.
function checklistLines(): string[] {
  const elapsed = Math.floor((Date.now() - started) / 1000);
  const rs = rows();
  const active = rs.findIndex((r) => r.status !== "up"); // the step we're waiting on
  const spin = SPIN[frame % SPIN.length];
  const lines: string[] = [];
  const stackLabel = HOSTED ? `on ${NET} (hosted)` : "localnet";
  lines.push(`${c.bold}Starting anonboard ${stackLabel}${c.reset}  ${c.dim}(${elapsed}s · logs → .dev.log)${c.reset}`);
  lines.push("");
  rs.forEach((r, i) => {
    const mark =
      r.status === "up" ? MARK.up
      : r.status === "retry" ? `${c.yellow}${spin}${c.reset}`
      : i === active ? `${c.cyan}${spin}${c.reset}`
      : MARK.wait;
    const note = r.status === "up" ? "" : i === active && !r.note ? "working…" : r.note ?? "";
    lines.push(`  ${mark} ${pad(r.label, 24)}${c.dim}${pad(r.right, 34)}${c.reset}` + (note ? `${c.dim}${note}${c.reset}` : ""));
  });
  if (active >= 0) {
    lines.push("");
    lines.push(`  ${c.dim}↳ ${lastActivity() || "…"}${c.reset}`);
  }
  return lines;
}

// The ready banner (post-ready). A single re-renderable block: the Operator line
// flips from "warming" to "Join enabled" in place when the deferred operator comes
// up, so the status stays consistent (no frozen row + contradicting line below).
function readyLines(): string[] {
  const warming = SERVICES.some((sv) => sv.blocking === false && !states[sv.key]);
  const line = (label: string, url: string, tail = "", tailColor = c.dim) =>
    `  ${c.dim}${pad(label, 10)}${c.reset}${c.cyan}${url}${c.reset}${tail ? `  ${tailColor}${tail}${c.reset}` : ""}`;
  return [
    `${c.green}${c.bold}✓ anonboard is ready${warming ? " to post" : ""}${c.reset}`,
    "",
    line("Open", "http://localhost:5173", "← the app"),
    line("Sync API", "http://localhost:9999/api/posts"),
    warming
      ? line("Operator", "http://localhost:3335", "warming — Join enabled shortly", c.yellow)
      : line("Operator", "http://localhost:3335", "✓ Join enabled", c.green),
    line("Batcher", "http://localhost:3334"),
    `  ${c.dim}${pad("Chain", 10)}${c.reset}${c.dim}${HOSTED ? `Midnight ${NET} (hosted) · proof :6300` : "Midnight :9944 / :8088 / :6300"}   ${solanaReaderPort ? "Solana devnet (persistent)" : "Solana :8899"}${c.reset}`,
    "",
    `  ${c.dim}logs:${c.reset} bun run dev:logs   ${c.dim}status:${c.reset} bun run dev:status   ${c.dim}stop:${c.reset} Ctrl-C  ${c.dim}(or bun run dev:stop)${c.reset}`,
  ];
}

function render() {
  const lines = ready ? readyLines() : checklistLines();
  const block = lines.map((l) => clampWidth(l, process.stdout.columns ?? 0, c.reset)).join("\n") + "\n";
  if (isTTY) {
    if (lastLines) process.stdout.write(`\x1b[${lastLines}A\x1b[0J`);
    process.stdout.write(block);
    lastLines = lines.length;
  } else {
    process.stdout.write(block + "\n");
  }
}

// Port-poll updates the checklist state; the animation ticks separately so the spinner
// and the live activity line keep moving between polls.
// Signature of the deferred services' readiness at the last banner render — so we only
// redraw the banner when the operator actually flips (not every poll).
let lastDeferredSig = "";
async function poll() {
  const s: Record<string, boolean> = {};
  await Promise.all(
    SERVICES.map(async (sv) => {
      // A dead port un-sticks the row (so a crashed service after warmup goes red, and the
      // banner won't claim ready). A slow health check on a LIVE port stays green (sticky),
      // so transient slowness (e.g. /api/posts under heavy catch-up) doesn't flip it back.
      // On devnet there's no local validator — the "Solana" row tracks the sync shim instead.
      const port = sv.key === "solana" && solanaReaderPort ? solanaReaderPort : sv.port;
      if (!(await tcpOpen(port))) {
        s[sv.key] = false;
        return;
      }
      const up = sv.http ? await httpOk(sv.http) : true;
      s[sv.key] = states[sv.key] || up;
    }),
  );
  states = s;

  // Fire the banner once the BLOCKING services are up (posting works). Non-blocking
  // services (the operator, needed only to join) warm up in the background — the banner
  // shows them "warming" and flips them to "Join enabled" in place, so their dust sync
  // doesn't delay "ready to post" yet the status never goes stale.
  const coreReady = SERVICES.every((sv) => sv.blocking === false || states[sv.key]);
  const deferred = SERVICES.filter((sv) => sv.blocking === false);
  const deferredSig = deferred.map((sv) => (states[sv.key] ? "1" : "0")).join("");

  if (coreReady && !ready) {
    ready = true;
    lastDeferredSig = deferredSig;
    render(); // checklist collapses into the ready banner (operator may still be warming)
  } else if (ready && deferredSig !== lastDeferredSig) {
    lastDeferredSig = deferredSig;
    render(); // a deferred service flipped — redraw the banner in place (warming → enabled)
  } else if (!isTTY && !ready) {
    render(); // non-TTY: print progress each poll (no animation)
  }

  if (ready && deferred.every((sv) => states[sv.key])) return; // everything up now — stop polling
  if (!stopping) setTimeout(poll, 1000);
}

function tick() {
  if (ready || stopping || !isTTY) return;
  frame++;
  render();
  setTimeout(tick, 120);
}

process.stdout.write(`${c.dim}booting… first cold start downloads toolchains and waits on dust; give it a few minutes.${c.reset}\n\n`);
void poll();
tick();
