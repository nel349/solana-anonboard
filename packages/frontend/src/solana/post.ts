// Build a gasless post transaction and hand it to the batcher: the badge author
// signs (free), the sponsor is the fee payer and co-signs at the batcher. Returns
// { ok } or { ok:false, message } — the caller owns UI state.
import {
  Connection,
  Keypair,
  Transaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import bs58 from "bs58";
import {
  createPostInstruction,
  DEV_BATCHER_TARGET,
} from "@solana-anonboard/contracts-solana";
import { RPC, BATCHER_URL, SPONSOR, ADDRESS_TYPE_SOLANA } from "../config.ts";

export async function submitPost(
  badge: Keypair,
  body: string,
): Promise<{ ok: boolean; message?: string }> {
  const conn = new Connection(RPC, "confirmed");
  const { blockhash } = await conn.getLatestBlockhash("confirmed");

  const tx = new Transaction();
  tx.feePayer = SPONSOR;
  tx.recentBlockhash = blockhash;
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 80_000 }));
  tx.add(createPostInstruction(badge.publicKey, body));
  tx.partialSign(badge);

  const b64 = tx.serialize({ requireAllSignatures: false }).toString("base64");
  const sig = tx.signatures.find((s) => s.publicKey.equals(badge.publicKey))?.signature;

  const res = await fetch(`${BATCHER_URL}/send-input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: {
        target: DEV_BATCHER_TARGET,
        address: badge.publicKey.toBase58(),
        addressType: ADDRESS_TYPE_SOLANA,
        input: b64,
        signature: sig ? bs58.encode(sig) : "",
        timestamp: Date.now().toString(),
      },
      confirmationLevel: "wait-receipt",
    }),
  });
  const j = await res.json().catch(() => ({}));
  return res.ok ? { ok: true } : { ok: false, message: String(j.message ?? res.status) };
}
