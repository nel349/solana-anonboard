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
// Labels the batcher's EffectStream-processed check only, which the account model gates off
// (posts confirm by tx receipt + the reader's getProgramAccounts fold, not a Solana sync).
// Inert at runtime; kept because the adapter config requires the field. Not the removed
// parallelSolanaRPC sync protocol — that leg no longer exists.
const SYNC_PROTOCOL_NAME =
  process.env.SOLANA_SYNC_PROTOCOL_NAME ?? "solana-accounts";
const NAMESPACE = process.env.BATCHER_NAMESPACE ?? DEV_NAMESPACE;
const POLLING_INTERVAL_MS = Number(process.env.BATCHER_POLLING_MS ?? "1000");

const PKG_DIR = import.meta.dirname!;
const BATCHER_KEYPAIR =
  process.env.SOLANA_BATCHER_KEYPAIR ?? path.join(PKG_DIR, "keypair", "batcher-wallet.json");

const solana = createSolanaAdapter({
  rpcUrl: RPC_URL,
  batcherKeypairPath: BATCHER_KEYPAIR,
  syncProtocolName: SYNC_PROTOCOL_NAME,
  targetProgramId: process.env.POST_PROGRAM_ID ?? POST_PROGRAM_ID,
  // Account-storage model: the sponsor (payer) IS an instruction account — it funds each
  // post PDA's rent (see createPostInstruction, payer is a signer+writable key). This MUST
  // stay true; setting it false strips the sponsor from the accounts and breaks every post.
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
  // Account-storage model: a post is confirmed by its on-chain tx receipt, then the
  // standalone solana-post-reader folds the PDA account into the DB (getProgramAccounts).
  // There is no EffectStream Solana sync leg, so wait-effectstream-processed would block
  // forever on a SyncChains event nothing emits. wait-receipt is the correct default here.
  confirmationLevel: "wait-receipt",
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
