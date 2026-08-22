import { assert } from "../helpers.ts";
import { POST_PROGRAM_ID } from "@solana-anonboard/contracts-solana";
import { Keypair } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import path from "node:path";

const RPC_URL = "http://localhost:8899";

// The batcher/sponsor keypair is generated on first run (not committed), so its address
// is not a fixed constant. Read it from the same file airdrop.ts funds and batcher.dev.ts
// spends (packages/batcher/keypair/batcher-wallet.json) — a hardcoded address goes stale
// the moment a clone generates its own key.
function batcherAddress(): string {
  const keypairPath =
    process.env.SOLANA_BATCHER_KEYPAIR ??
    path.resolve(import.meta.dirname!, "../../batcher/keypair/batcher-wallet.json");
  const secret = Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8")));
  return Keypair.fromSecretKey(secret).publicKey.toBase58();
}

async function rpc(method: string, params: unknown[] = []) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await res.json()).result;
}

export async function chainReadyTest() {
  await assert("Solana validator responds to getHealth", async () => {
    const result = await rpc("getHealth");
    return result === "ok";
  });

  await assert("Post program is loaded at POST_PROGRAM_ID", async () => {
    const result = await rpc("getAccountInfo", [
      POST_PROGRAM_ID,
      { encoding: "base64" },
    ]);
    return result?.value != null && result.value.executable === true;
  });

  await assert("Batcher wallet received the airdrop", async () => {
    // Use 'processed': finalized lags ~30 slots on a fresh validator, so airdrops aren't final yet.
    const result = await rpc("getBalance", [
      batcherAddress(),
      { commitment: "processed" },
    ]);
    const lamports: number = result?.value ?? 0;
    return lamports > 0;
  });
}
