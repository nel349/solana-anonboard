// Regression for the browser bug "b.writeBigUInt64LE is not a function": the frontend's Buffer
// polyfill lacks the BigInt read/write methods, so u64 <-> bytes is done by hand. These assert
// the hand-rolled bytes are byte-identical to Node's Buffer (so PDAs derive the same on-chain).
import { describe, it, expect } from "bun:test";
import { u64leBytes, u64leNumber } from "./u64.ts";

const CASES = [0, 1, 5, 255, 256, 65535, 65536, 486042095, 1234567890123];

describe("u64 little-endian (browser-safe)", () => {
  it("encodes byte-identically to Node's writeBigUInt64LE", () => {
    for (const n of CASES) {
      const ref = Buffer.alloc(8);
      ref.writeBigUInt64LE(BigInt(n));
      expect([...u64leBytes(n)]).toEqual([...ref]);
    }
  });
  it("round-trips through encode/decode", () => {
    for (const n of CASES) expect(u64leNumber(u64leBytes(n))).toBe(n);
  });
  it("reads at an offset (counter layout: tag(1) + count(8))", () => {
    const bytes = new Uint8Array(9);
    bytes.set(u64leBytes(42), 1);
    expect(u64leNumber(bytes, 1)).toBe(42);
  });
});
