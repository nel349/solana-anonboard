import {
  ConfigBuilder,
  ConfigNetworkType,
  ConfigSyncProtocolType,
} from "@effectstream/config";
import {
  PrimitiveTypeMidnightGeneric,
  PrimitiveTypeSolanaProgramLog,
} from "@effectstream/sm/builtin";
import { COUNTER_PROGRAM_ID } from "@solana-starter/contracts-solana/program-id";
import { readMidnightContract } from "@effectstream/midnight-contracts/read-contract";
import { midnightNetworkConfig } from "@effectstream/midnight-contracts/midnight-env";
import * as AnonboardContract from "@anonboard/midnight-contract/contract";

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
        blockTimeMS: 1000,
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
          pollingInterval: 1000,
        }),
      )
      .addParallel(
        (networks) => (networks as any).solanaMain,
        (_network, _deployments) => ({
          name: "parallelSolanaRPC",
          type: ConfigSyncProtocolType.SOLANA_RPC_PARALLEL,
          startBlockHeight: 0,
          pollingInterval: 2000,
          delayMs: 2400,
          confirmationDepth: 32,
          stepSize: 10,
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
      // Public, high-frequency leg: every post lands here.
      .addPrimitive(
        (syncProtocols) => (syncProtocols as any).parallelSolanaRPC,
        (_network, _deployments, _syncProtocol) => ({
          name: "SolanaProgramLog",
          type: PrimitiveTypeSolanaProgramLog,
          startBlockHeight: 0,
          programId: COUNTER_PROGRAM_ID,
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

export { COUNTER_PROGRAM_ID };
