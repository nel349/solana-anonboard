import path from "node:path";
import type { OrchestratorConfig } from "@effectstream/orchestrator/config";
import { launchPglite, DbNames } from "@effectstream/orchestrator/launch-pglite";
import { launchSolana, SolanaNames } from "@effectstream/orchestrator/scripts/launch-solana";
import { launchMidnight, MidnightNames } from "@effectstream/orchestrator/launch-midnight";
import { midnightPlan } from "../../localnet-preflight.ts";

const root = path.resolve(import.meta.dirname!, "../..");

// The sync node reads the deployed Midnight contract address at import time
// (config.dev.ts → readMidnightContract), so it cannot start until the deploy
// step has finished.
const midnightDeps = [MidnightNames.CONTRACT_DEPLOY];

// build-counter must finish before the validator (chain-start.ts needs
// counter.so for --bpf-program).
// Use `cwd`, not `resolveFrom`: resolveFrom can't see this template's own
// workspace packages when the orchestrator is installed from npm, not symlinked.
const solanaProcesses = launchSolana("@solana-anonboard/node", {
  cwd: path.join(root, "packages/node"),
});
const idx = solanaProcesses.findIndex((p) => p.name === SolanaNames.SOLANA_VALIDATOR);
if (idx >= 0) {
  solanaProcesses[idx] = {
    ...solanaProcesses[idx],
    dependsOn: [...(solanaProcesses[idx].dependsOn ?? []), "build-counter"],
  };
}

// Same smart Midnight leg as dev: attach to a running localnet or self-host one,
// never force-freeing a shared port. This is what lets the tests run against an
// already-running localnet instead of killing it.
const mnPlan = midnightPlan();
console.log(`[localnet] Midnight -> ${mnPlan.mode}: ${mnPlan.reason}`);
const contractsMidnightCwd = path.join(root, "packages/contracts-midnight");
const deployEnv = { MIDNIGHT_STORAGE_PASSWORD: "YourPasswordMy1!" };

let midnightProcesses;
if (mnPlan.mode === "self-host") {
  midnightProcesses = launchMidnight(
    "@solana-anonboard/contracts-midnight",
    { cwd: contractsMidnightCwd },
    { dependsOn: ["midnight-contract-compile"], env: deployEnv },
  );
  for (const p of midnightProcesses)
    delete (p as { stopProcessAtPort?: number[] }).stopProcessAtPort;
} else {
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
    {
      name: "build-counter",
      description: "Build the Solana counter program (.so)",
      cwd: path.join(root, "packages/contracts-solana"),
      args: ["run", "scripts/build.ts"],
      waitToExit: true,
      type: "system-dependency",
      critical: true,
      env: { SKIP_SOLANA_BUILD: process.env.SKIP_SOLANA_BUILD ?? "1" },
    },
    ...solanaProcesses,

    // Midnight leg: compile the Compact circuit, then either self-host the local
    // node/indexer/proof + deploy, or (if a localnet is already running) fund +
    // deploy against it — see the smart plan above.
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
      stopProcessAtPort: [3334],
      dependsOn: ["airdrop-batcher"],
    },
    {
      name: "sync",
      description: "Sync node ( test mode )",
      args: ["run", "packages/node/main.dev.ts"],
      waitToExit: false,
      type: "system-dependency",
      env: { PGLITE: "true", ENABLE_DEV_AND_DEBUG_ENDPOINTS: "true" },
      dependsOn: [
        DbNames.PGLITE_WAIT,
        SolanaNames.SOLANA_VALIDATOR_WAIT,
        ...midnightDeps,
      ],
    },
  ],
} satisfies OrchestratorConfig;
