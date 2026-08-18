import { deployMidnightContract } from "@effectstream/midnight-contracts/deploy";
import type { DeployConfig } from "@effectstream/midnight-contracts/types";
import { midnightNetworkConfig } from "@effectstream/midnight-contracts/midnight-env";
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

async function main(): Promise<void> {
  const contractAddress = await deployMidnightContract(config, midnightNetworkConfig);

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
