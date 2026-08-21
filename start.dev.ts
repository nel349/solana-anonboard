import path from "node:path";
import type { OrchestratorConfig } from "@effectstream/orchestrator/config";
import { launchPglite, DbNames } from "@effectstream/orchestrator/launch-pglite";
import { launchSolana, SolanaNames } from "@effectstream/orchestrator/scripts/launch-solana";
import { launchMidnight, MidnightNames } from "@effectstream/orchestrator/launch-midnight";
import { midnightPlan } from "./localnet-preflight.ts";
import { midnightNetwork } from "./packages/contracts-midnight/networks.ts";

const root = import.meta.dirname!;

// The sync node cannot start until the Midnight contract is deployed:
// config.dev.ts calls readMidnightContract() at import time.
const midnightDeps = [MidnightNames.CONTRACT_DEPLOY];

// Validator waits on the anonboard build (needs build/anonboard.so for `--bpf-program`).
// cwd, not resolveFrom: require.resolve can't see this template's workspace
// packages once @effectstream/orchestrator is an installed npm dep.
// On devnet the Solana chain is hosted (dev.ts provisioned it) — skip the local validator.
const DEVNET = process.env.SOLANA_NETWORK === "devnet";
const solanaProcesses = DEVNET
  ? []
  : launchSolana("@solana-anonboard/node", { cwd: path.join(root, "packages/node") });
const solanaValidatorIdx = solanaProcesses.findIndex(
  (p) => p.name === SolanaNames.SOLANA_VALIDATOR,
);
if (solanaValidatorIdx >= 0) {
  solanaProcesses[solanaValidatorIdx] = {
    ...solanaProcesses[solanaValidatorIdx],
    dependsOn: [
      ...(solanaProcesses[solanaValidatorIdx].dependsOn ?? []),
      "build-anonboard",
    ],
  };
}

// On devnet the SDK's Solana leg is disabled (it can't getBlock on public devnet); a standalone
// reader folds posts from devnet via getSignaturesForAddress+getTransaction (O(our posts),
// bounded) into the same posts table, with its own pglite connection + a health port.
const SOLANA_READER_PORT = 8898;
const readerProcesses = DEVNET
  ? [
      {
        name: "solana-post-reader",
        description: "Devnet Solana post reader (folds posts via getSignaturesForAddress)",
        cwd: root,
        args: ["run", "packages/node/solana-post-reader.ts"],
        env: { PGLITE: "true" },
        waitToExit: false,
        type: "system-dependency" as const,
        link: `http://127.0.0.1:${SOLANA_READER_PORT}`,
        stopProcessAtPort: [SOLANA_READER_PORT],
        dependsOn: [DbNames.PGLITE_WAIT],
      },
    ]
  : [];

// Endpoints for the active Midnight network come from the single source of truth
// (networks.ts). Export them as the MIDNIGHT_* overrides the vendored SDK reads, so
// the sync node, deploy, and operator use the exact URLs the frontend does.
const netId = process.env.MIDNIGHT_NETWORK_ID ?? "undeployed";
const net = midnightNetwork(netId);
const hosted = netId !== "undeployed";

// On a hosted net, every server-side indexer client (sync node, deploy, operator,
// fund) is routed through a local rate-limiting proxy (packages/node/indexer-proxy.ts)
// so their combined request rate stays under the hosted indexer's per-IP WAF limit.
// Clients see only the local URL — same path as the real indexer — and the proxy
// forwards to the real origin. On undeployed there is no proxy: clients talk to the
// local indexer directly.
const INDEXER_PROXY_PORT = 8079;
const proxied = (real: string, scheme: "http" | "ws"): string =>
  `${scheme}://127.0.0.1:${INDEXER_PROXY_PORT}${new URL(real).pathname}`;

const midnightEnv = {
  MIDNIGHT_INDEXER_HTTP: hosted ? proxied(net.indexer, "http") : net.indexer,
  MIDNIGHT_INDEXER_WS: hosted ? proxied(net.indexerWS, "ws") : net.indexerWS,
  MIDNIGHT_NODE_HTTP: net.node,
  MIDNIGHT_PROOF_SERVER_URL: net.proofServer,
  // A hosted wallet must finish syncing dust before it can pay tx fees (deploy,
  // add_to_roster, the join fee). The wallet build returns as soon as its legs reach
  // tip, so this is a ceiling, not a fixed wait: on preview all legs complete in ~230s;
  // preprod's dust ledger is heavier and takes longer, so the ceiling is generous.
  // SKIP_WAIT_FOR_FUNDS is only a backstop — if a leg is pathologically slow, proceed
  // once the ceiling elapses (dust has synced by then) rather than hang forever.
  // Undeployed syncs instantly, so neither applies there.
  ...(hosted
    ? { MIDNIGHT_SKIP_WAIT_FOR_FUNDS: "true", MIDNIGHT_WALLET_SYNC_TIMEOUT_MS: "900000" }
    : {}),
};

// The proxy process itself talks to the REAL indexer origins (its clients talk to it).
const indexerProxyEnv = {
  INDEXER_PROXY_PORT: String(INDEXER_PROXY_PORT),
  INDEXER_PROXY_HTTP_ORIGIN: new URL(net.indexer).origin,
  INDEXER_PROXY_WS_ORIGIN: `${new URL(net.indexerWS).protocol}//${new URL(net.indexerWS).host}`,
};

const contractsMidnightCwd = path.join(root, "packages/contracts-midnight");
const deployEnv = {
  MIDNIGHT_STORAGE_PASSWORD: "YourPasswordMy1!",
  ...midnightEnv,
  // Forwarded from the dev wrapper's reuse/redeploy prompt: when set, the deploy step
  // deploys a fresh contract instead of skipping because a record exists.
  ...(process.env.ANONBOARD_REDEPLOY ? { ANONBOARD_REDEPLOY: process.env.ANONBOARD_REDEPLOY } : {}),
};

// Only probe the local ports when we're actually running a local chain.
const mnPlan = hosted ? null : midnightPlan();
if (mnPlan) console.log(`[network] Midnight -> ${mnPlan.mode}: ${mnPlan.reason}`);

let midnightProcesses;
if (hosted) {
  // Hosted TestNet (preview/preprod): the node + indexer are Midnight-hosted, so run
  // only the LOCAL proof server (it proves here, then submits to the hosted node),
  // fund the deploy wallet on that net, and deploy to it. Solana stays local. Requires
  // a real MIDNIGHT_OWNER_KEY and a funded MIDNIGHT_WALLET_SEED (see README).
  console.log(`[network] Midnight -> hosted (${netId}); local proof server + deploy`);
  const nodeWs = net.node.replace(/^http/, "ws"); // http->ws, https->wss
  midnightProcesses = [
    {
      name: "midnight-indexer-proxy",
      description: `Rate-limiting gateway in front of the ${netId} indexer`,
      cwd: root,
      args: ["run", "packages/node/indexer-proxy.ts"],
      env: indexerProxyEnv,
      link: `http://127.0.0.1:${INDEXER_PROXY_PORT}`,
      stopProcessAtPort: [INDEXER_PROXY_PORT],
    },
    {
      name: "midnight-indexer-proxy-wait",
      description: "Wait for the indexer proxy",
      cwd: contractsMidnightCwd,
      args: ["run", "midnight-indexer-proxy:wait"],
      env: indexerProxyEnv,
      waitToExit: true,
      dependsOn: ["midnight-indexer-proxy"],
    },
    {
      name: "midnight-proof-server",
      description: "Midnight proof server (local; proves then submits to the hosted node)",
      cwd: contractsMidnightCwd,
      args: ["run", "midnight-proof-server:start"],
      env: { SUBSTRATE_NODE_WS_URL: nodeWs },
      link: "http://localhost:6300",
    },
    {
      name: "midnight-proof-server-wait",
      description: "Wait for the local proof server",
      cwd: contractsMidnightCwd,
      args: ["run", "midnight-proof-server:wait"],
      waitToExit: true,
      dependsOn: ["midnight-proof-server"],
    },
    {
      name: "midnight-fund",
      description: `Fund the deploy wallet on ${netId} (best-effort; set MIDNIGHT_WALLET_SEED to a funded seed)`,
      cwd: root,
      args: ["run", "scripts/midnight-fund.ts"],
      waitToExit: true,
      dependsOn: ["midnight-contract-compile", "midnight-indexer-proxy-wait"],
      env: midnightEnv,
    },
    {
      name: MidnightNames.CONTRACT_DEPLOY,
      description: `Deploy the anonboard contract to ${netId}`,
      cwd: contractsMidnightCwd,
      args: ["run", "midnight-contract:deploy"],
      env: deployEnv,
      waitToExit: true,
      critical: true,
      dependsOn: [
        "midnight-contract-compile",
        "midnight-proof-server-wait",
        "midnight-fund",
        "midnight-indexer-proxy-wait",
      ],
    },
  ];
} else if (mnPlan!.mode === "self-host") {
  // Boot the full localnet — but strip stopProcessAtPort so we never force-free a
  // shared port (the preflight already confirmed these ports are ours to use).
  midnightProcesses = launchMidnight(
    "@solana-anonboard/contracts-midnight",
    { cwd: contractsMidnightCwd },
    { dependsOn: ["midnight-contract-compile"], env: deployEnv },
  );
  for (const p of midnightProcesses)
    delete (p as { stopProcessAtPort?: number[] }).stopProcessAtPort;

  // launchMidnight's env param doesn't reach the deploy in this version, so set the
  // centralized endpoints (+ storage password) on it explicitly — otherwise the deploy
  // falls back to the SDK's stale default (v3) while everything else uses networks.ts.
  const deployProc = midnightProcesses.find((p) => p.name === MidnightNames.CONTRACT_DEPLOY);
  if (deployProc)
    (deployProc as { env?: Record<string, string> }).env = {
      ...((deployProc as { env?: Record<string, string> }).env ?? {}),
      ...deployEnv,
    };

  // Start every boot from a fresh chain. The node persists state in .midnight-data,
  // so a re-run would RESUME an aged chain — and a fresh indexer catching up THROUGH
  // an already-crossed epoch hits the vendored spo-indexer's process_next_epoch
  // crash (an untagged-enum decode error) and wedges the whole localnet. Booting
  // from genesis avoids it: an indexer connected from block 0 rides epoch crossings
  // without crashing (verified past slot 300). Reset also drops the stale
  // contract-*.json so the deploy re-runs against the new chain instead of skipping.
  // Self-host only — never wipe an attached chain we don't own. See
  // docs/internal/LOCALNET-DESIGN.md.
  const reset = {
    name: "midnight-reset",
    description: "Wipe stale localnet chain state for a fresh boot",
    cwd: contractsMidnightCwd,
    args: ["run", "midnight:reset"],
    waitToExit: true,
    critical: true,
  };
  for (const p of midnightProcesses)
    (p as { dependsOn?: string[] }).dependsOn = ["midnight-reset", ...(p.dependsOn ?? [])];
  midnightProcesses = [reset, ...midnightProcesses];

  // Belt-and-suspenders: the indexer can still exit on the block-#1 startup race on
  // a cold chain; the orchestrator has no restart field, so supervise it.
  const indexer = midnightProcesses.find((p) => p.name === MidnightNames.INDEXER);
  if (indexer)
    indexer.args = ["run", path.join(root, "scripts/restart-on-failure.ts"), ...indexer.args];
} else {
  // Attach: skip node/indexer/proof entirely; fund the deploy wallet, then deploy.
  midnightProcesses = [
    {
      name: "midnight-fund",
      description: "Fund the deploy wallet on the attached localnet (mn)",
      cwd: root,
      args: ["run", "scripts/midnight-fund.ts"],
      waitToExit: true,
      critical: true,
      dependsOn: ["midnight-contract-compile"],
    },
    {
      name: MidnightNames.CONTRACT_DEPLOY,
      description: "Deploy the anonboard contract (attached localnet)",
      cwd: contractsMidnightCwd,
      args: ["run", "midnight-contract:deploy"],
      env: deployEnv,
      waitToExit: true,
      critical: true,
      dependsOn: ["midnight-contract-compile", "midnight-fund"],
    },
  ];
}

export default {
  processes: [
    ...launchPglite(),

    // SKIP_SOLANA_BUILD=1 (default) reuses build/anonboard.so when present and
    // compiles it when absent; set =0 to force a recompile every boot.
    {
      name: "build-anonboard",
      description: "Build the Solana anonboard post program (.so)",
      cwd: path.join(root, "packages/contracts-solana"),
      args: ["run", "scripts/build.ts"],
      waitToExit: true,
      type: "system-dependency",
      critical: true,
      env: { SKIP_SOLANA_BUILD: process.env.SKIP_SOLANA_BUILD ?? "1" },
    },

    ...solanaProcesses,
    ...readerProcesses,

    {
      name: "midnight-contract-compile",
      description: "Compile the anonboard Compact circuit",
      cwd: path.join(root, "packages/contracts-midnight/contract-anonboard"),
      args: ["run", "compact"],
      waitToExit: true,
      type: "system-dependency",
      critical: true,
    },

    ...midnightProcesses,

    {
      name: "sync",
      description: "Anonboard sync node (Solana + Midnight)",
      args: ["run", "packages/node/main.dev.ts"],
      waitToExit: false,
      type: "system-dependency",
      env: { PGLITE: "true", ...midnightEnv },
      dependsOn: [
        DbNames.PGLITE_WAIT,
        ...(DEVNET ? [] : [SolanaNames.SOLANA_VALIDATOR_WAIT]),
        ...midnightDeps,
      ],
    },

    // dependsOn deploy: reads the contract address + builds the owner wallet.
    {
      name: "operator",
      description: "Midnight operator (roster registrar + join fee-payer)",
      args: ["run", "packages/operator/operator.dev.ts"],
      waitToExit: false,
      type: "system-dependency",
      link: "http://localhost:3335",
      stopProcessAtPort: [3335],
      env: midnightEnv,
      dependsOn: [...midnightDeps],
    },

    // Local validator only: fund the batcher from genesis. On devnet the fee-payer is
    // already faucet-funded by the provision step.
    ...(DEVNET
      ? []
      : [
          {
            name: "airdrop-batcher",
            description: "Airdrop SOL to batcher wallet",
            args: ["run", "packages/node/airdrop.ts"],
            waitToExit: true,
            type: "system-dependency" as const,
            dependsOn: [SolanaNames.SOLANA_VALIDATOR_WAIT],
          },
        ]),

    {
      name: "batcher",
      description: "Solana transaction batcher ( fee-payer )",
      args: ["run", "packages/batcher/batcher.dev.ts"],
      waitToExit: false,
      type: "system-dependency",
      link: "http://localhost:3334",
      stopProcessAtPort: [3334],
      dependsOn: DEVNET ? [] : ["airdrop-batcher"],
    },

    {
      name: "frontend",
      description: "Vite + React frontend on :5173",
      cwd: path.join(root, "packages/frontend"),
      args: ["run", "dev"],
      waitToExit: false,
      type: "system-dependency",
      link: "http://localhost:5173",
      stopProcessAtPort: [5173],
      // Tells the UI which Midnight network to read (endpoints come from networks.ts).
      env: { VITE_MIDNIGHT_NETWORK_ID: netId },
      // Wait on the Midnight deploy, not just the batcher: predev copy-zk reads
      // the compiled join keys + deployed address; booting first copies
      // half-written keys (proof server then 400s).
      dependsOn: ["batcher", ...midnightDeps],
    },
  ],
} satisfies OrchestratorConfig;
