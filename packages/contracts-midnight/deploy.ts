import { deployMidnightContract } from "@effectstream/midnight-contracts/deploy";
import type { DeployConfig, WalletResult } from "@effectstream/midnight-contracts/types";
import { midnightNetworkConfig } from "@effectstream/midnight-contracts/midnight-env";
import {
  buildWalletFacade,
  syncAndWaitForFunds,
} from "@effectstream/midnight-contracts/wallet-info";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import WebSocket from "ws";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  Anonboard,
  createAnonboardPrivateState,
  witnesses,
} from "./contract-anonboard/src/_index.ts";

import { OWNER_SECRET_KEY, assertLocalOwnerKey } from "./owner-key.ts";
import { recordDeployment } from "./deployments.ts";
import { primeDustSnapshotViaMn } from "./mn-dust-prime.ts";

// Never deploy with the committed dev owner key on anything but the local chain.
assertLocalOwnerKey(midnightNetworkConfig.id);

const config: DeployConfig = {
  contractName: "contract-anonboard",
  contractFileName: "contract-anonboard.json",
  contractClass: Anonboard.Contract,
  witnesses,
  privateStateId: "anonboardPrivateState",
  initialPrivateState: createAnonboardPrivateState(OWNER_SECRET_KEY),
  privateStateStoreName: "anonboard-private-state",
};

// Build the deploy wallet with dust pre-synced via mn's fast indexer-direct reader,
// then hand it to deployMidnightContract as `walletResult` so it skips its own cold
// dust scan. On preprod that scan never completes ("could not balance dust") and the
// deploy dies; mn primes the same dust in ~9s. Best-effort: if mn is unavailable,
// return undefined and let deployMidnightContract cold-sync internally (the prior
// behaviour) — the deploy only spends dust, so we skip the shielded wait either way.
async function buildDeployWallet(): Promise<WalletResult | undefined> {
  const net = midnightNetworkConfig;
  const dlog = (m: string) => console.error(`[deploy] ${m}`);
  try {
    const snapshot = await primeDustSnapshotViaMn(net.id, net.walletSeed!, {
      log: dlog,
      timeoutMs: 300_000,
    });
    const urls = {
      id: net.id,
      indexer: net.indexer,
      indexerWS: net.indexerWS,
      node: net.node,
      proofServer: net.proofServer,
    };
    const wallet = await buildWalletFacade(urls as never, net.walletSeed!, net.id as never, "all" as never, snapshot);
    await syncAndWaitForFunds(wallet.wallet as never, { skipShielded: true });
    dlog("deploy wallet ready (dust primed via mn)");
    return wallet;
  } catch (e) {
    dlog(`mn dust prime unavailable (${e instanceof Error ? e.message : String(e)}); cold-syncing dust via SDK`);
    return undefined;
  }
}

async function main(): Promise<void> {
  const walletResult = await buildDeployWallet();
  const contractAddress = await deployMidnightContract(
    config,
    midnightNetworkConfig,
    undefined,
    walletResult ? { walletResult } : undefined,
  );

  // Record the block the contract was deployed at, so the sync can start there instead
  // of replaying the whole chain from block 1. On a hosted net that replay is thousands
  // of indexer requests and gets rate-limited (403); from the deploy block it's a handful.
  // One query — cheap, and it runs before the sync starts hammering the indexer.
  setNetworkId(midnightNetworkConfig.id);
  const publicData = indexerPublicDataProvider(
    midnightNetworkConfig.indexer,
    midnightNetworkConfig.indexerWS,
    WebSocket,
  );
  const deployBlock = (await publicData.watchForDeployTxData(contractAddress)).blockHeight;

  // The SDK already wrote { contractAddress }; add the deploy block to it.
  const jsonPath = path.resolve(
    import.meta.dirname!,
    `contract-anonboard.${midnightNetworkConfig.id}.json`,
  );
  const json = JSON.parse(readFileSync(jsonPath, "utf8"));
  writeFileSync(jsonPath, JSON.stringify({ ...json, deployBlock }, null, 2));

  // Also record it in the consolidated deployments index (the reuse/redeploy prompt
  // and an at-a-glance view of what's deployed where read from this).
  recordDeployment(
    midnightNetworkConfig.id,
    { contractAddress, deployBlock },
    new Date().toISOString(),
  );

  console.log(`Deployment successful (deploy block ${deployBlock})`);
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
