// Unit tests for the arbiter's pure parsers. These verify actual values (a
// base58 round-trip, exact author/body strings), not just "didn't throw" — a bug
// here silently looks like "nobody has a badge". Run: bun test (from this package).
import { describe, it, expect } from "bun:test";
import bs58 from "bs58";
import { hexToBase58 } from "../log-parse.ts";

describe("hexToBase58", () => {
  it("converts 32 bytes of hex to base58 that decodes back to the same bytes", () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff);
    const hex = Buffer.from(bytes).toString("hex");
    const out = hexToBase58(hex);
    expect(out).not.toBeNull();
    expect(Array.from(bs58.decode(out!))).toEqual(Array.from(bytes)); // exact value
    expect(out).toBe(bs58.encode(bytes)); // and it's the canonical encoding
  });

  it("treats a 0x-prefixed hex identically to the bare hex", () => {
    const hex = "aa".repeat(32);
    expect(hexToBase58("0x" + hex)).toBe(hexToBase58(hex));
  });

  it("accepts uppercase hex and produces the same bytes as lowercase", () => {
    const hex = "abcdef".padEnd(64, "0");
    expect(hexToBase58(hex.toUpperCase())).toBe(hexToBase58(hex));
  });

  it("encodes all-zero bytes (does not treat empty as absent)", () => {
    const out = hexToBase58("00".repeat(32));
    expect(out).not.toBeNull();
    expect(Array.from(bs58.decode(out!))).toEqual(new Array(32).fill(0));
  });

  it("returns null for the wrong length (not exactly 32 bytes)", () => {
    expect(hexToBase58("ab".repeat(31))).toBeNull(); // 62 chars
    expect(hexToBase58("ab".repeat(33))).toBeNull(); // 66 chars
    expect(hexToBase58("")).toBeNull();
  });

  it("returns null for non-hex characters", () => {
    expect(hexToBase58("zz".repeat(32))).toBeNull();
    expect(hexToBase58("gg" + "00".repeat(31))).toBeNull();
  });
});
