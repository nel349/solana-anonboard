// Deploy the anonboard contract only when needed — and never reuse a STALE artifact.
//
// A localnet chain is ephemeral (the Docker node has no data volume; a restart/recreate
// wipes it to a fresh genesis). The deploy artifact (contract-anonboard.<net>.json) can
// survive that reset, so blindly reusing it points the operator + sync node at a contract
// that isn't on the current chain. findDeployedContract's watchForDeployTxData then waits
// forever (no timeout) → the whole stack hangs "warming up". So on localnet we reuse the
// artifact only if its contract is actually present on-chain; otherwise we re-deploy.
//
// Hosted nets (preview/preprod) don't reset, so we trust the artifact there — a slow
// indexer must never trigger an expensive, address-changing re-deploy.
// Set ANONBOARD_REDEPLOY=1 to force a fresh deploy on any network.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { midnightNetworkConfig } from "@effectstream/midnight-contracts/midnight-env";
import { deployDecision } from "./deploy-decision.ts";

const NET = midnightNetworkConfig.id;
const ARTIFACT = path.resolve(import.meta.dirname!, `contract-anonboard.${NET}.json`);

function runDeploy(): never {
  const r = spawnSync("bun", ["run", "deploy.ts"], {
    cwd: import.meta.dirname!,
    stdio: "inherit",
    env: process.env,
  });
  process.exit(r.status ?? 1);
}

// Is `address` present on the current chain? One indexer GraphQL query, short timeout.
async function contractOnChain(address: string): Promise<boolean> {
  const res = await fetch(midnightNetworkConfig.indexer, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `{ contractAction(address: "${address}") { __typename } }`,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json()) as { data?: { contractAction?: unknown } };
  return json?.data?.contractAction != null;
}

async function main(): Promise<void> {
  const artifactExists = existsSync(ARTIFACT);
  const contractAddress: string | null = artifactExists
    ? (JSON.parse(readFileSync(ARTIFACT, "utf8")).contractAddress ?? null)
    : null;
  const isLocalnet = NET === "undeployed";

  // Only probe the chain when it can actually change the decision (localnet, artifact present).
  let onChain: boolean | null = null;
  if (isLocalnet && artifactExists && contractAddress && !process.env.ANONBOARD_REDEPLOY) {
    try {
      onChain = await contractOnChain(contractAddress);
    } catch (e) {
      console.warn(`[ensure-deployed] on-chain check failed (${e instanceof Error ? e.message : e}); treating artifact as stale`);
      onChain = false;
    }
  }

  const decision = deployDecision({
    redeployForced: !!process.env.ANONBOARD_REDEPLOY,
    artifactExists,
    contractAddress,
    isLocalnet,
    contractOnChain: onChain,
  });

  if (decision === "reuse") {
    console.log(`[ensure-deployed] reusing ${contractAddress!.slice(0, 10)}… on ${NET}`);
    process.exit(0);
  }
  if (artifactExists && contractAddress && isLocalnet && onChain === false) {
    console.log(`[ensure-deployed] artifact ${contractAddress.slice(0, 10)}… is not on ${NET} (chain reset?) — re-deploying`);
  } else {
    console.log(`[ensure-deployed] deploying anonboard contract on ${NET}…`);
  }
  runDeploy();
}

if (import.meta.main) {
  main().catch((e: unknown) => {
    console.error("[ensure-deployed]", e);
    process.exit(1);
  });
}
