// Gasless posting through the batcher.
//
// The poster (a badge holder from blind-join, poster.json) holds ZERO SOL. It
// builds a post whose fee-payer is the batcher's sponsor, signs only its own
// authority, and hands it to the batcher's /send-input. The batcher co-signs as
// fee-payer and submits. The author pays nothing on either chain.
//
// Mirrors packages/frontend/src/App.tsx exactly (the shipped gasless path).
//
// Devnet-aware: the same env seams the frontend/batcher use (SOLANA_RPC_URL,
// POST_PROGRAM_ID, SOLANA_BATCHER_KEYPAIR — all exported by `SOLANA_NETWORK=devnet`)
// point this at whatever Solana the running stack targets. Unset → local dev.

import { readFileSync } from "node:fs";
import path from "node:path";
import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  createPostInstruction,
  POST_PROGRAM_ID,
  DEV_RPC_URL,
  DEV_BATCHER_URL,
  DEV_BATCHER_FEE_PAYER,
  DEV_BATCHER_TARGET,
} from "@solana-anonboard/contracts-solana";

const RPC = process.env.SOLANA_RPC_URL ?? DEV_RPC_URL;
const PROGRAM_ID = process.env.POST_PROGRAM_ID ?? POST_PROGRAM_ID;
const BATCHER_URL = process.env.BATCHER_URL ?? DEV_BATCHER_URL;
// The fee-payer MUST be the batcher's own key. On devnet the stack exports the batcher
// keypair path, so derive the sponsor from it; otherwise the committed local sponsor.
const SPONSOR = process.env.SOLANA_BATCHER_KEYPAIR
  ? Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(process.env.SOLANA_BATCHER_KEYPAIR, "utf8"))),
    ).publicKey
  : new PublicKey(process.env.VITE_BATCHER_FEE_PAYER ?? DEV_BATCHER_FEE_PAYER);
const ADDRESS_TYPE_SOLANA = 9;
const BODY = process.env.POST_BODY ?? "gasless: i hold zero SOL and still posted";

async function main() {
  const posterFile = path.resolve(import.meta.dirname!, "..", "poster.json");
  const poster = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(posterFile, "utf8"))),
  );
  const conn = new Connection(RPC, "confirmed");

  const before = await conn.getBalance(poster.publicKey);
  console.log(`poster ${poster.publicKey.toBase58()}`);
  console.log(`poster SOL before: ${before / 1e9}`);
  if (before !== 0) {
    console.warn("WARNING: poster is not at 0 SOL; gasless claim is only clean at 0.");
  }

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction();
  tx.feePayer = SPONSOR;
  tx.recentBlockhash = blockhash;
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 80_000 }));
  tx.add(createPostInstruction(poster.publicKey, BODY, PROGRAM_ID));

  tx.partialSign(poster);
  const base64 = tx.serialize({ requireAllSignatures: false }).toString("base64");
  const userSig = tx.signatures.find((s) =>
    s.publicKey.equals(poster.publicKey),
  )?.signature;

  console.log("posting via batcher (sponsor co-signs + pays)…");
  const res = await fetch(`${BATCHER_URL}/send-input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: {
        target: DEV_BATCHER_TARGET,
        address: poster.publicKey.toBase58(),
        addressType: ADDRESS_TYPE_SOLANA,
        input: base64,
        signature: userSig ? bs58.encode(userSig) : "",
        timestamp: Date.now().toString(),
      },
      // wait-receipt: confirm it landed on-chain without blocking on EffectStream sync (verdict checked separately).
      confirmationLevel: "wait-receipt",
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`batcher rejected: ${body.message ?? res.status}`);
    process.exit(1);
  }
  console.log(`batcher accepted. tx ${String(body.transactionHash ?? "").slice(0, 16)}…`);

  const after = await conn.getBalance(poster.publicKey);
  console.log(`poster SOL after:  ${after / 1e9}`);
  console.log(
    after === before
      ? "\nGASLESS CONFIRMED: author balance unchanged; the sponsor paid."
      : `\nNOTE: author balance changed by ${(before - after) / 1e9} SOL.`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("gasless-post failed:", e);
  process.exit(1);
});
