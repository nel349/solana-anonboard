import path from "node:path";
import type { OrchestratorConfig } from "@effectstream/orchestrator/config";
import { launchPglite, DbNames } from "@effectstream/orchestrator/launch-pglite";
import { launchSolana, SolanaNames } from "@effectstream/orchestrator/scripts/launch-solana";
import { launchMidnight, MidnightNames } from "@effectstream/orchestrator/launch-midnight";
import { midnightPlan } from "../../localnet-preflight.ts";
import { POST_PROGRAM_ID } from "@solana-anonboard/contracts-solana";

const root = path.resolve(import.meta.dirname!, "../..");

// The sync node reads the deployed Midnight contract address at import time
// (config.dev.ts → readMidnightContract), so it cannot start until the deploy
// step has finished.
const midnightDeps = [MidnightNames.CONTRACT_DEPLOY];

// build-anonboard must finish before the validator (chain-start.ts needs
// anonboard.so for --bpf-program).
// Use `cwd`, not `resolveFrom`: resolveFrom can't see this template's own
// workspace packages when the orchestrator is installed from npm, not symlinked.
const solanaProcesses = launchSolana("@solana-anonboard/node", {
  cwd: path.join(root, "packages/node"),
});
const idx = solanaProcesses.findIndex((p) => p.name === SolanaNames.SOLANA_VALIDATOR);
if (idx >= 0) {
  solanaProcesses[idx] = {
    ...solanaProcesses[idx],
    dependsOn: [...(solanaProcesses[idx].dependsOn ?? []), "build-anonboard"],
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
  // The vendored indexer 4.3.3 can crash on a freshly-wiped chain (spo-indexer
  // process_next_epoch race); the orchestrator has no restart, so supervise it.
  const indexer = midnightProcesses.find((p) => p.name === MidnightNames.INDEXER);
  if (indexer)
    indexer.args = ["run", path.join(root, "scripts/restart-on-failure.ts"), ...indexer.args];
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

    // The real operator daemon — the roster-write path the browser join uses.
    // Covered by stm/operator-register.test.ts; started here so the E2E exercises
    // operator.dev.ts itself (not a harness re-implementation of add_to_roster).
    {
      name: "operator",
      description: "Midnight operator (roster registrar + join fee-payer)",
      cwd: root,
      args: ["run", "packages/operator/operator.dev.ts"],
      waitToExit: false,
      type: "system-dependency",
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
      stopProcessAtPort: [3334],
      dependsOn: ["airdrop-batcher"],
    },
    {
      // Folds Solana posts (PDA accounts, getProgramAccounts) into the posts table — the
      // account-storage replacement for the removed SDK Solana sync leg. Without it nothing
      // ingests posts and the STM/API post assertions time out. Mirrors start.dev.ts.
      name: "solana-post-reader",
      description: "Solana post reader (folds posts via getProgramAccounts)",
      args: ["run", "packages/node/solana-post-reader.ts"],
      waitToExit: false,
      type: "system-dependency",
      env: {
        PGLITE: "true",
        SOLANA_READER_UPSTREAM: "http://localhost:8899",
        SOLANA_READER_PROGRAM_ID: POST_PROGRAM_ID,
      },
      dependsOn: [DbNames.PGLITE_WAIT, SolanaNames.SOLANA_VALIDATOR_WAIT],
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
