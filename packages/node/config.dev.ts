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

const midnight = readMidnightContract("contract-anonboard", {
  networkId: midnightNetworkConfig.id,
});

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
          startBlockHeight: 1,
          pollingInterval: 1000,
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
          startBlockHeight: 1,
          contractAddress: midnight.contractAddress,
          stateMachinePrefix: "midnight-badges",
          contract: { ledger: AnonboardContract.ledger },
          ledgerSchema: {
            owner: "bytes",
            roster: { type: "map", value: "boolean" },
            badges: { type: "map", value: "boolean" },
            badge_count: "uint64",
          },
          networkId: midnightNetworkConfig.id,
        }),
      ),
  )
  .build();
