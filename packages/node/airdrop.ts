// Airdrops SOL to the batcher fee-payer wallet for local dev.
// Uses @solana/web3.js, not the vendored solana CLI: the CLI's airdrop returns 400
// against its own test validator, while the requestAirdrop RPC it wraps succeeds.
// Also drops a dependency on the vendored binary's path.
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import fs from "node:fs";
import path from "node:path";

const RPC_PORT = process.env.SOLANA_RPC_PORT ?? "8899";
const RPC_URL = `http://localhost:${RPC_PORT}`;

const BATCHER_KEYPAIR = path.resolve(
  import.meta.dirname!,
  "../batcher/keypair/batcher-wallet.json",
);

/** The test validator caps a single airdrop, so top up across a few rounds. */
const AIRDROP_SOL = 100;
const AIRDROP_ROUNDS = 2;

function fail(msg: string): never {
  console.error(`[airdrop] ${msg}`);
  process.exit(1);
}

async function main() {
  if (!fs.existsSync(BATCHER_KEYPAIR)) {
    fail(`batcher keypair not found at ${BATCHER_KEYPAIR}`);
  }

  const secret = Uint8Array.from(
    JSON.parse(fs.readFileSync(BATCHER_KEYPAIR, "utf-8")) as number[],
  );
  const pubkey = Keypair.fromSecretKey(secret).publicKey;
  console.log(`[airdrop] batcher wallet: ${pubkey.toBase58()}`);

  const connection = new Connection(RPC_URL, "confirmed");

  for (let i = 1; i <= AIRDROP_ROUNDS; i++) {
    try {
      const sig = await connection.requestAirdrop(
        pubkey,
        AIRDROP_SOL * LAMPORTS_PER_SOL,
      );
      await connection.confirmTransaction(sig, "confirmed");
      console.log(`[airdrop] round ${i}: ${AIRDROP_SOL} SOL (${sig})`);
    } catch (e) {
      // Warn rather than crash the orchestrator: a later round may still land.
      console.warn(`[airdrop] round ${i} failed (continuing): ${String(e)}`);
    }
  }

  const balance = await connection.getBalance(pubkey, "confirmed");
  console.log(`[airdrop] balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  if (balance === 0) {
    // Fail loudly: downstream batcher tests all assume this wallet is funded.
    fail("batcher wallet still has 0 SOL — the batcher cannot pay fees");
  }
}

main().catch((e) => fail(String(e)));
