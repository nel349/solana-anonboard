import path from "node:path";
import type { OrchestratorConfig } from "@effectstream/orchestrator/config";
import { launchPglite, DbNames } from "@effectstream/orchestrator/launch-pglite";
import { launchSolana, SolanaNames } from "@effectstream/orchestrator/scripts/launch-solana";
import { launchMidnight, MidnightNames } from "@effectstream/orchestrator/launch-midnight";
import { midnightPlan } from "./localnet-preflight.ts";

const root = import.meta.dirname!;

// The sync node cannot start until the Midnight contract is deployed:
// config.dev.ts calls readMidnightContract() at import time.
const midnightDeps = [MidnightNames.CONTRACT_DEPLOY];

// Validator waits on the anonboard build (needs build/anonboard.so for `--bpf-program`).
// cwd, not resolveFrom: require.resolve can't see this template's workspace
// packages once @effectstream/orchestrator is an installed npm dep.
const solanaProcesses = launchSolana("@solana-anonboard/node", {
  cwd: path.join(root, "packages/node"),
});
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

// Decide the Midnight leg: self-host a fresh localnet, or attach to a running one.
// Never force-frees a shared port. See docs/internal/LOCALNET-DESIGN.md.
const mnPlan = midnightPlan();
console.log(`[localnet] Midnight -> ${mnPlan.mode}: ${mnPlan.reason}`);
const contractsMidnightCwd = path.join(root, "packages/contracts-midnight");
const deployEnv = { MIDNIGHT_STORAGE_PASSWORD: "YourPasswordMy1!" };

let midnightProcesses;
if (mnPlan.mode === "self-host") {
  // Boot the full localnet — but strip stopProcessAtPort so we never force-free a
  // shared port (the preflight already confirmed these ports are ours to use).
  midnightProcesses = launchMidnight(
    "@solana-anonboard/contracts-midnight",
    { cwd: contractsMidnightCwd },
    { dependsOn: ["midnight-contract-compile"], env: deployEnv },
  );
  for (const p of midnightProcesses)
    delete (p as { stopProcessAtPort?: number[] }).stopProcessAtPort;
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
      env: { PGLITE: "true" },
      dependsOn: [
        DbNames.PGLITE_WAIT,
        SolanaNames.SOLANA_VALIDATOR_WAIT,
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
      dependsOn: [...midnightDeps],
    },

    {
      name: "airdrop-batcher",
      description: "Airdrop SOL to batcher wallet",
      args: ["run", "packages/node/airdrop.ts"],
      waitToExit: true,
      type: "system-dependency",
      dependsOn: [SolanaNames.SOLANA_VALIDATOR_WAIT],
    },

    {
      name: "batcher",
      description: "Solana transaction batcher ( fee-payer )",
      args: ["run", "packages/batcher/batcher.dev.ts"],
      waitToExit: false,
      type: "system-dependency",
      link: "http://localhost:3334",
      stopProcessAtPort: [3334],
      dependsOn: ["airdrop-batcher"],
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
      // Wait on the Midnight deploy, not just the batcher: predev copy-zk reads
      // the compiled join keys + deployed address; booting first copies
      // half-written keys (proof server then 400s).
      dependsOn: ["batcher", ...midnightDeps],
    },
  ],
} satisfies OrchestratorConfig;
