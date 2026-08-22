import {
  ConfigBuilder,
  ConfigNetworkType,
  ConfigSyncProtocolType,
} from "@effectstream/config";
import { PrimitiveTypeMidnightGeneric } from "@effectstream/sm/builtin";
import { readMidnightContract } from "@effectstream/midnight-contracts/read-contract";
import { midnightNetworkConfig } from "@effectstream/midnight-contracts/midnight-env";
import * as AnonboardContract from "@solana-anonboard/midnight-contract/contract";
import { fetchOnChainBadges } from "./badge-seed.ts";
import { readFileSync } from "node:fs";

// This SDK sync reads ONLY the Midnight badge set (both local + devnet). Solana posts are folded
// by the standalone solana-post-reader from the program's accounts (getProgramAccounts) — so there
// is no Solana leg here. (The SDK's Solana leg read via getBlock, which public devnet bans and
// whose deploy-block replay grows unbounded; account state has neither problem.)

const midnight = readMidnightContract("contract-anonboard", {
  networkId: midnightNetworkConfig.id,
});

// The live sync only reads contract state on blocks where the contract is *called*, so a near-head
// start would miss past joins. Instead we seed the existing badge set from on-chain state
// (badge-seed.ts, consumed by main.dev.ts) and start the live sync near head — existing members
// from the seed, new joins from the live sync. This avoids the deploy-block replay whose catch-up
// grows unbounded as the chain advances. One fetch drives both. If it fails, fall back to the
// deploy block so a replay still finds every badge.
let deployBlock = 1;
try {
  const info = JSON.parse(
    readFileSync(
      new URL(
        `../contracts-midnight/contract-anonboard.${midnightNetworkConfig.id}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
  if (typeof info.deployBlock === "number") deployBlock = info.deployBlock;
} catch {
  /* no deploy block recorded */
}

export const seededBadges = await fetchOnChainBadges();
let midnightStartBlock = deployBlock;
// Start the live sync this many blocks behind head. The seed's contract state and the head come
// from one query, but if the indexer's contract-action indexing lags the tip, a join in that
// window would be in neither the seed nor a near-head start. A generous buffer covers realistic
// indexer lag; the extra blocks are a few cheap batched requests.
const HEAD_BUFFER = 200;
if (seededBadges && seededBadges.height - HEAD_BUFFER > midnightStartBlock) {
  midnightStartBlock = seededBadges.height - HEAD_BUFFER;
}
console.log(
  seededBadges
    ? `[sync] seeded ${seededBadges.badges.length} on-chain badge(s); Midnight starts near head (block ${midnightStartBlock})`
    : `[sync] on-chain seed unavailable; Midnight starts at deploy block ${midnightStartBlock}`,
);

export const config = new ConfigBuilder()
  .setNamespace((builder) => builder.setSecurityNamespace("anonboard"))
  .buildNetworks((builder) =>
    builder
      .addNetwork({
        name: "ntp",
        type: ConfigNetworkType.NTP,
        startTime: new Date().getTime(),
        // blockTimeMS = merge quantization. Immutable — changes only on a fresh chain.
        blockTimeMS: 250,
      })
      .addNetwork({
        name: "midnight",
        type: ConfigNetworkType.MIDNIGHT,
        networkId: midnightNetworkConfig.id,
        nodeUrl: midnightNetworkConfig.node,
      }),
  )
  .buildDeployments((builder) => builder)
  .buildSyncProtocols((builder) =>
    builder
      .addMain(
        (networks) => networks.ntp,
        (_network, _deployments) => ({
          name: "mainNtp",
          type: ConfigSyncProtocolType.NTP_MAIN,
          chainUri: "",
          startBlockHeight: 1,
          pollingInterval: 250,
        }),
      )
      .addParallel(
        (networks) => (networks as any).midnight,
        (_network, _deployments) => ({
          name: "parallelMidnight",
          type: ConfigSyncProtocolType.MIDNIGHT_PARALLEL,
          startBlockHeight: midnightStartBlock,
          // On a hosted net the badge sync starts at the deploy block — potentially thousands
          // behind. Fetch 50 blocks/request (vs the default 10) and poll often; the proxy still
          // paces requests under the indexer's WAF limit.
          pollingInterval: 250,
          stepSize: 50,
          indexer: midnightNetworkConfig.indexer,
        }),
      ),
  )
  .buildPrimitives((builder) =>
    // Private leg: the badge set, read straight off Midnight's public ledger. `ledgerSchema` keys
    // MUST be in Compact declaration order. `used` (the nullifier map) is declared last in the
    // contract and is deliberately absent — it is not exported, so the node could not read it.
    builder.addPrimitive(
      (syncProtocols) => (syncProtocols as any).parallelMidnight,
      (_network, _deployments, _syncProtocol) => ({
        name: "MidnightAnonboard",
        type: PrimitiveTypeMidnightGeneric,
        startBlockHeight: midnightStartBlock,
        contractAddress: midnight.contractAddress,
        stateMachinePrefix: "midnight-badges",
        contract: { ledger: AnonboardContract.ledger },
        ledgerSchema: {
          owner: "bytes",
          roster: "bytes",
          badges: { type: "map", value: "boolean" },
          badge_count: "uint64",
        },
        networkId: midnightNetworkConfig.id,
      }),
    ),
  )
  .build();
