// Client-side instruction builder for the post program. Mirrors the Rust
// handler in programs/anonboard/src/lib.rs — the byte layout (discriminant byte
// then the UTF-8 body) is part of the program's wire format, so keep in sync.
import {
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import { Buffer } from "buffer";
import {
  POST_PROGRAM_ID,
  DISCRIMINANT_POST,
} from "./program-id.ts";

// A post writes no account, so the only key it needs is the author as signer.
// `body` is UTF-8 in the instruction data after the discriminant byte.
export function createPostInstruction(
  author: PublicKey,
  body: string,
): TransactionInstruction {
  const bodyBytes = Buffer.from(body, "utf8");
  const data = Buffer.concat([Buffer.from([DISCRIMINANT_POST]), bodyBytes]);
  return new TransactionInstruction({
    programId: new PublicKey(POST_PROGRAM_ID),
    keys: [{ pubkey: author, isSigner: true, isWritable: false }],
    data,
  });
}
