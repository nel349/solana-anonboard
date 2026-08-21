// Unit tests for the client instruction builders + PDA derivation. These assert the account
// ORDER, signer/writable FLAGS, instruction DATA, and PDA SEEDS the frontend/batcher produce —
// all of which must match the on-chain program (programs/anonboard/src/lib.rs). A drift here
// (wrong account order, wrong seed) makes every post fail on-chain, so it's covered directly.
import { describe, it, expect } from "bun:test";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { Buffer } from "buffer";
import {
  createPostInstruction,
  createCloseInstruction,
  counterPda,
  postPda,
  decodePostAccount,
  DISCRIMINANT_POST,
  DISCRIMINANT_CLOSE,
  POST_SEED,
  COUNTER_SEED,
  POST_PROGRAM_ID,
  POST_LAYOUT,
  MAX_BODY,
  TAG_POST,
} from "./mod.ts";
import { u64leBytes } from "./u64.ts";

const author = new PublicKey("GUFpBaBzYw5XPfuhkp38z8bG3hKV151tEpXHhHLkTbMN");
const payer = new PublicKey("3oFfnPdVbZZRapZTLgZ1ZDCmdf4YjGMpzDgukoWYpXqW");
const PROG = POST_PROGRAM_ID;

describe("PDA derivation (seeds must match lib.rs)", () => {
  it("counterPda uses [COUNTER_SEED, author]", () => {
    const expected = PublicKey.findProgramAddressSync(
      [Buffer.from(COUNTER_SEED), author.toBuffer()],
      new PublicKey(PROG),
    )[0];
    expect(counterPda(author, PROG).toBase58()).toBe(expected.toBase58());
  });
  it("postPda uses [POST_SEED, author, u64le(index)] for every index", () => {
    for (const i of [0, 1, 42, 486042095]) {
      const expected = PublicKey.findProgramAddressSync(
        [Buffer.from(POST_SEED), author.toBuffer(), u64leBytes(i)],
        new PublicKey(PROG),
      )[0];
      expect(postPda(author, i, PROG).toBase58()).toBe(expected.toBase58());
    }
  });
  it("postPda is deterministic and distinct per index", () => {
    expect(postPda(author, 0, PROG).toBase58()).toBe(postPda(author, 0, PROG).toBase58());
    expect(postPda(author, 0, PROG).toBase58()).not.toBe(postPda(author, 1, PROG).toBase58());
  });
});

describe("createPostInstruction (accounts + data must match the Post handler)", () => {
  const ix = createPostInstruction(author, payer, 7, "hi", PROG);
  it("targets the program", () => expect(ix.programId.toBase58()).toBe(PROG));
  it("has the exact account order the program reads (next_account_info)", () => {
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual([
      author.toBase58(),
      counterPda(author, PROG).toBase58(),
      postPda(author, 7, PROG).toBase58(),
      payer.toBase58(),
      SystemProgram.programId.toBase58(),
    ]);
  });
  it("has correct signer/writable flags (author signs, payer signs+writes, PDAs write)", () => {
    expect(ix.keys.map((k) => [k.isSigner, k.isWritable])).toEqual([
      [true, false], // author signs, doesn't pay
      [false, true], // counter PDA (program-signed via seeds)
      [false, true], // post PDA
      [true, true], // payer signs + funds rent
      [false, false], // system program
    ]);
  });
  it("encodes data as [DISCRIMINANT_POST, ...utf8(body)]", () => {
    expect(ix.data[0]).toBe(DISCRIMINANT_POST);
    expect(Buffer.from(ix.data.subarray(1)).toString("utf8")).toBe("hi");
  });
});

describe("createCloseInstruction (accounts + data must match the Close handler)", () => {
  const ix = createCloseInstruction(author, 3, payer, PROG);
  it("has [author(signer), post(writable), refund(writable)]", () => {
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual([
      author.toBase58(),
      postPda(author, 3, PROG).toBase58(),
      payer.toBase58(),
    ]);
    expect(ix.keys.map((k) => [k.isSigner, k.isWritable])).toEqual([
      [true, false],
      [false, true],
      [false, true],
    ]);
  });
  it("encodes data as [DISCRIMINANT_CLOSE]", () => {
    expect([...ix.data]).toEqual([DISCRIMINANT_CLOSE]);
  });
});

describe("decodePostAccount (round-trips the on-chain layout)", () => {
  function encode(a: PublicKey, p: PublicKey, slot: number, index: number, body: string): Uint8Array {
    const buf = Buffer.alloc(POST_LAYOUT.body + MAX_BODY);
    buf[0] = TAG_POST;
    a.toBuffer().copy(buf, POST_LAYOUT.author);
    p.toBuffer().copy(buf, POST_LAYOUT.payer);
    buf.set(u64leBytes(slot), POST_LAYOUT.slot);
    buf.set(u64leBytes(index), POST_LAYOUT.index);
    const b = Buffer.from(body, "utf8");
    buf.writeUInt16LE(b.length, POST_LAYOUT.bodyLen);
    b.copy(buf, POST_LAYOUT.body);
    return Uint8Array.from(buf);
  }
  it("recovers author/payer/slot/index/body (incl. pipes + unicode)", () => {
    expect(decodePostAccount(encode(author, payer, 99, 4, "gm ✅|pipe"))).toEqual({
      author: author.toBase58(),
      payer: payer.toBase58(),
      slot: 99,
      index: 4,
      body: "gm ✅|pipe",
    });
  });
  it("rejects a wrong tag or a short buffer", () => {
    const wrongTag = encode(author, payer, 1, 0, "x");
    wrongTag[0] = TAG_POST + 1;
    expect(decodePostAccount(wrongTag)).toBeNull();
    expect(decodePostAccount(Uint8Array.of(1, 2, 3))).toBeNull();
  });
});
