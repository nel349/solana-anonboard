// Client-side instruction builders for the account-storage post program. The account order
// and byte layout mirror the Rust handlers in programs/anonboard/src/lib.rs — keep in sync.
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { Buffer } from "buffer";
import {
  POST_PROGRAM_ID,
  DISCRIMINANT_POST,
  DISCRIMINANT_CLOSE,
  POST_SEED,
  COUNTER_SEED,
} from "./program-id.ts";

function u64le(n: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

// The author's post-counter PDA (holds their next index).
export function counterPda(author: PublicKey, programId: string = POST_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(COUNTER_SEED), author.toBuffer()],
    new PublicKey(programId),
  )[0];
}

// The deterministic address of an author's post #index — read it directly with getAccountInfo.
export function postPda(
  author: PublicKey,
  index: number,
  programId: string = POST_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(POST_SEED), author.toBuffer(), u64le(index)],
    new PublicKey(programId),
  )[0];
}

// The author's next post index (0 if they've never posted), read from their counter account.
export async function nextPostIndex(
  conn: Connection,
  author: PublicKey,
  programId: string = POST_PROGRAM_ID,
): Promise<number> {
  const info = await conn.getAccountInfo(counterPda(author, programId));
  if (!info || info.data.length < 9) return 0;
  return Number(Buffer.from(info.data).readBigUInt64LE(1));
}

// Post: the author signs (free); the sponsor (payer) funds the fee + the post/counter rent.
export function createPostInstruction(
  author: PublicKey,
  payer: PublicKey,
  index: number,
  body: string,
  programId: string = POST_PROGRAM_ID,
): TransactionInstruction {
  const pid = new PublicKey(programId);
  return new TransactionInstruction({
    programId: pid,
    keys: [
      { pubkey: author, isSigner: true, isWritable: false },
      { pubkey: counterPda(author, programId), isSigner: false, isWritable: true },
      { pubkey: postPda(author, index, programId), isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([DISCRIMINANT_POST]), Buffer.from(body, "utf8")]),
  });
}

// Close: the author deletes post #index; rent refunds to `refundDest`, which the program
// requires to equal the original payer (sponsor) — so a close can't drain the sponsor.
export function createCloseInstruction(
  author: PublicKey,
  index: number,
  refundDest: PublicKey,
  programId: string = POST_PROGRAM_ID,
): TransactionInstruction {
  const pid = new PublicKey(programId);
  return new TransactionInstruction({
    programId: pid,
    keys: [
      { pubkey: author, isSigner: true, isWritable: false },
      { pubkey: postPda(author, index, programId), isSigner: false, isWritable: true },
      { pubkey: refundDest, isSigner: false, isWritable: true },
    ],
    data: Buffer.from([DISCRIMINANT_CLOSE]),
  });
}
