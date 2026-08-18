import {
  ConfigBuilder,
  ConfigNetworkType,
  ConfigSyncProtocolType,
} from "@effectstream/config";
import {
  PrimitiveTypeMidnightGeneric,
  PrimitiveTypeSolanaProgramLog,
} from "@effectstream/sm/builtin";
import { POST_PROGRAM_ID } from "@solana-anonboard/contracts-solana/program-id";
import { readMidnightContract } from "@effectstream/midnight-contracts/read-contract";
import { midnightNetworkConfig } from "@effectstream/midnight-contracts/midnight-env";
import * as AnonboardContract from "@solana-anonboard/midnight-contract/contract";
import { fetchOnChainBadges } from "./badge-seed.ts";
import { readFileSync } from "node:fs";

const midnight = readMidnightContract("contract-anonboard", {
  networkId: midnightNetworkConfig.id,
});

// The live sync only reads contract state on blocks where the contract is *called*, so
// a near-head start would miss past joins. Instead we seed the existing badge set from
// on-chain state (badge-seed.ts, consumed by main.dev.ts) and start the live sync near
// head — existing members from the seed, new joins from the live sync. This avoids the
// deploy-block replay whose catch-up grows unbounded as the chain advances. One fetch
// drives both. If it fails, fall back to the deploy block so a replay still finds every
// badge.
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
// Start the live sync this many blocks behind head. The seed's contract state and the
// head come from one query, but if the indexer's contract-action indexing lags the tip,
// a join in that window would be in neither the seed nor a near-head start. A generous
// buffer covers realistic indexer lag; the extra blocks are a few cheap batched requests.
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
        // blockTimeMS = merge quantization: a Solana post lands only on a main-block
        // boundary. 250ms (was 1000) trims up to 0.75s latency. Immutable — changes
        // only on a fresh chain.
        blockTimeMS: 250,
      })
      .addNetwork({
        name: "solanaMain",
        type: ConfigNetworkType.SOLANA,
        rpcUrl: "http://localhost:8899",
        networkId: "localnet",
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
          pollingInterval: 250, // match blockTimeMS so the clock is read every tick
        }),
      )
      .addParallel(
        (networks) => (networks as any).solanaMain,
        (_network, _deployments) => ({
          name: "parallelSolanaRPC",
          type: ConfigSyncProtocolType.SOLANA_RPC_PARALLEL,
          startBlockHeight: 0,
          pollingInterval: 250, // poll near Solana's slot time; localhost, no cost
          // delayMs is a HARD FLOOR on landing (post lands at blockTime+delayMs).
          // Must stay ≳ the real fetch lag (≈1 slot + poll) or the merge jitters.
          // 800ms sits safely above that while staying sub-second.
          delayMs: 800,
          // Reorg protection on top of 'confirmed'. localnet has no forks so 1 is
          // safe; raise on a public/forking chain (the only faithfulness trade-off here).
          confirmationDepth: Number(process.env.SOLANA_CONFIRMATION_DEPTH ?? "1"),
          stepSize: 10, // catch-up batch only; no effect on steady-state latency
        }),
      )
      .addParallel(
        (networks) => (networks as any).midnight,
        (_network, _deployments) => ({
          name: "parallelMidnight",
          type: ConfigSyncProtocolType.MIDNIGHT_PARALLEL,
          startBlockHeight: midnightStartBlock,
          // The state machine can't finalize a "now" Solana post until Midnight reaches
          // "now", and on a hosted net it starts at the deploy block — potentially
          // thousands behind. Fetch 50 blocks/request (vs the default 10) and poll often;
          // the proxy still paces requests under the indexer's WAF limit.
          pollingInterval: 250,
          stepSize: 50,
          indexer: midnightNetworkConfig.indexer,
        }),
      ),
  )
  .buildPrimitives((builder) =>
    builder
      .addPrimitive(
        (syncProtocols) => (syncProtocols as any).parallelSolanaRPC,
        (_network, _deployments, _syncProtocol) => ({
          name: "SolanaProgramLog",
          type: PrimitiveTypeSolanaProgramLog,
          startBlockHeight: 0,
          programId: POST_PROGRAM_ID,
          stateMachinePrefix: "solana-post",
        }),
      )
      // Private leg: the badge set, read straight off Midnight's public
      // ledger. `ledgerSchema` keys MUST be in Compact declaration order.
      // `used` (the nullifier map) is declared last in the contract and is
      // deliberately absent here — it is not exported, so the node could
      // not read it even if we asked.
      .addPrimitive(
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
            // roster is a HistoricMerkleTree, not parsed here (this positional
            // schema has no Merkle type). The sync node only needs `badges`;
            // "bytes" is a harmless placeholder that keeps badges at the right
            // index (parses to null — a MerkleTree StateValue isn't a cell).
            roster: "bytes",
            badges: { type: "map", value: "boolean" },
            badge_count: "uint64",
          },
          networkId: midnightNetworkConfig.id,
        }),
      ),
  )
  .build();
