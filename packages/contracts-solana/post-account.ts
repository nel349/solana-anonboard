// Decode a post account's raw bytes into a post. One source of the on-chain layout — the
// program writes it (lib.rs), this reads it, and the devnet reader folds from it.
import { PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";
import { TAG_POST, POST_LAYOUT, MAX_BODY } from "./program-id.ts";

export type PostAccount = {
  author: string;
  payer: string;
  slot: number;
  index: number;
  body: string;
};

// Returns the decoded post, or null if the data isn't a post account (wrong tag / too short).
export function decodePostAccount(data: Uint8Array): PostAccount | null {
  // Post accounts are exactly POST_LAYOUT.body + MAX_BODY bytes; anything shorter isn't a post.
  if (data.length < POST_LAYOUT.body + MAX_BODY || data[0] !== TAG_POST) return null;
  const buf = Buffer.from(data);
  const bodyLen = buf.readUInt16LE(POST_LAYOUT.bodyLen);
  return {
    author: new PublicKey(buf.subarray(POST_LAYOUT.author, POST_LAYOUT.author + 32)).toBase58(),
    payer: new PublicKey(buf.subarray(POST_LAYOUT.payer, POST_LAYOUT.payer + 32)).toBase58(),
    slot: Number(buf.readBigUInt64LE(POST_LAYOUT.slot)),
    index: Number(buf.readBigUInt64LE(POST_LAYOUT.index)),
    body: buf.subarray(POST_LAYOUT.body, POST_LAYOUT.body + bodyLen).toString("utf8"),
  };
}
