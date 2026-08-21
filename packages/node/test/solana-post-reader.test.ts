// Unit tests for the devnet post reader core (account-storage version). These assert real
// values: a program account decodes to the exact post, non-post accounts (counters, garbage)
// are dropped, and posts come out oldest-slot-first. A bug here looks like "posts never appear
// on devnet". Run: bun test (from this package).
import { describe, it, expect } from "bun:test";
import { PublicKey } from "@solana/web3.js";
import { Buffer } from "node:buffer";
import { MAX_BODY, POST_LAYOUT, TAG_POST, TAG_COUNTER } from "@solana-anonboard/contracts-solana";
import { postsFromAccounts } from "../solana-post-reader-lib.ts";

const AUTHOR = new PublicKey(Uint8Array.from({ length: 32 }, (_, i) => (i + 1) & 0xff));
const PAYER = new PublicKey(Uint8Array.from({ length: 32 }, (_, i) => (i + 9) & 0xff));

// Mirror the program's write (lib.rs) so the test exercises the real decodePostAccount.
function encodePost(slot: number, index: number, body: string): Uint8Array {
  const buf = Buffer.alloc(POST_LAYOUT.body + MAX_BODY);
  buf[0] = TAG_POST;
  AUTHOR.toBuffer().copy(buf, POST_LAYOUT.author);
  PAYER.toBuffer().copy(buf, POST_LAYOUT.payer);
  buf.writeBigUInt64LE(BigInt(slot), POST_LAYOUT.slot);
  buf.writeBigUInt64LE(BigInt(index), POST_LAYOUT.index);
  const b = Buffer.from(body, "utf8");
  buf.writeUInt16LE(b.length, POST_LAYOUT.bodyLen);
  b.copy(buf, POST_LAYOUT.body);
  return Uint8Array.from(buf);
}
function encodeCounter(count: number): Uint8Array {
  const buf = Buffer.alloc(9);
  buf[0] = TAG_COUNTER;
  buf.writeBigUInt64LE(BigInt(count), 1);
  return Uint8Array.from(buf);
}

describe("postsFromAccounts", () => {
  it("decodes a post account to the exact fields", () => {
    const posts = postsFromAccounts([{ data: encodePost(60, 0, "gm|with pipe ✅") }]);
    expect(posts).toEqual([{ author: AUTHOR.toBase58(), body: "gm|with pipe ✅", slot: 60 }]);
  });

  it("drops non-post accounts (counter + garbage), keeps only posts", () => {
    const posts = postsFromAccounts([
      { data: encodeCounter(3) }, // tag = counter
      { data: encodePost(61, 1, "real") },
      { data: Uint8Array.of(1, 2, 3) }, // too short
    ]);
    expect(posts.map((p) => p.body)).toEqual(["real"]);
  });

  it("returns posts oldest-slot-first (DB insertion → newest gets the highest id)", () => {
    const posts = postsFromAccounts([
      { data: encodePost(200, 2, "third") },
      { data: encodePost(100, 0, "first") },
      { data: encodePost(150, 1, "second") },
    ]);
    expect(posts.map((p) => p.slot)).toEqual([100, 150, 200]);
  });

  it("handles an empty account list", () => {
    expect(postsFromAccounts([])).toEqual([]);
  });
});
