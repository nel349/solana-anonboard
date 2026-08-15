import path from "node:path";
import { main, suspend } from "effection";
import {
  createNewBatcher,
  FileStorage,
  type BatcherConfig,
} from "@effectstream/batcher-sdk";
import { createSolanaAdapter } from "./solana-adapter.ts";
import {
  DEV_RPC_URL,
  DEV_NAMESPACE,
  POST_PROGRAM_ID,
} from "@solana-anonboard/contracts-solana";

/**
 * Dev batcher entry point. HTTP: POST http://localhost:3334/send-input.
 *
 * IMPORTANT: `namespace` below MUST match the `securityNamespace` the
 * frontend uses to scope its signature, or every submit returns
 * `401 Invalid signature`.
 */
const PORT = Number(process.env.BATCHER_PORT ?? "3334");
const RPC_URL = process.env.SOLANA_RPC_URL ?? DEV_RPC_URL;
const SYNC_PROTOCOL_NAME =
  process.env.SOLANA_SYNC_PROTOCOL_NAME ?? "parallelSolanaRPC";
const NAMESPACE = process.env.BATCHER_NAMESPACE ?? DEV_NAMESPACE;
const POLLING_INTERVAL_MS = Number(process.env.BATCHER_POLLING_MS ?? "1000");

const PKG_DIR = import.meta.dirname!;
const BATCHER_KEYPAIR = path.join(
  PKG_DIR,
  "keypair",
  "batcher-wallet.json",
);

const solana = createSolanaAdapter({
  rpcUrl: RPC_URL,
  batcherKeypairPath: BATCHER_KEYPAIR,
  syncProtocolName: SYNC_PROTOCOL_NAME,
  targetProgramId: POST_PROGRAM_ID,
  // The counter program creates a PDA funded by the sponsor, so it must be
  // allowed to appear as the rent payer in the sponsored instruction.
  allowSponsorAsInstructionAccount: true,
});

const config: BatcherConfig = {
  pollingIntervalMs: POLLING_INTERVAL_MS,
  adapters: { solana },
  defaultTarget: "solana",
  namespace: NAMESPACE,
  batchingCriteria: {
    // Solana txs can't be merged, so maxBatchSize=1 — the queue gives retry, not batching.
    solana: { criteriaType: "size", maxBatchSize: 1 },
  },
  confirmationLevel: "wait-effectstream-processed",
  enableHttpServer: true,
  enableEventSystem: true,
  port: PORT,
};

const storage = new FileStorage("./batcher-data");
const batcher = createNewBatcher(config, storage);

main(function* () {
  console.log("Starting batcher...");
  console.log(`  rpc:       ${RPC_URL}`);
  console.log(`  sync:      ${SYNC_PROTOCOL_NAME}`);
  console.log(`  namespace: ${NAMESPACE}`);
  console.log(`  keypair:   ${BATCHER_KEYPAIR}`);

  batcher.addStateTransition("startup", ({ publicConfig }) => {
    console.log(
      `  polling every ${publicConfig.pollingIntervalMs} ms, target=${publicConfig.defaultTarget}`,
    );
  });

  batcher.addStateTransition("http:start", ({ port }) => {
    console.log(`  HTTP server ready on http://localhost:${port}`);
  });

  try {
    yield* batcher.runBatcher();
  } catch (err) {
    console.error("Batcher error:", err);
    yield* batcher.gracefulShutdownOp();
  }

  yield* suspend();
});
