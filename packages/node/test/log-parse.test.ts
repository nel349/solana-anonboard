// Unit tests for the arbiter's pure parsers. These verify actual values (a
// base58 round-trip, exact author/body strings), not just "didn't throw" — a bug
// here silently looks like "nobody has a badge". Run: bun test (from this package).
import { describe, it, expect } from "bun:test";
import bs58 from "bs58";
import { hexToBase58, parsePostLog, POST_LOG_PREFIX } from "../log-parse.ts";

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

describe("parsePostLog", () => {
  const AUTHOR = bs58.encode(Uint8Array.from({ length: 32 }, (_, i) => i + 1));

  it("parses a Solana-framed post log into exact author and body", () => {
    const r = parsePostLog(`Program log: ${POST_LOG_PREFIX}|${AUTHOR}|42|hello world`);
    expect(r).toEqual({ author: AUTHOR, body: "hello world" });
  });

  it("keeps '|' inside the body (only the first three fields are split)", () => {
    const r = parsePostLog(`${POST_LOG_PREFIX}|${AUTHOR}|7|a|b|c`);
    expect(r).toEqual({ author: AUTHOR, body: "a|b|c" });
  });

  it("parses a line without the 'Program log: ' framing", () => {
    const r = parsePostLog(`${POST_LOG_PREFIX}|${AUTHOR}|7|hi`);
    expect(r?.author).toBe(AUTHOR);
    expect(r?.body).toBe("hi");
  });

  it("allows an empty body (four fields, last empty)", () => {
    expect(parsePostLog(`${POST_LOG_PREFIX}|${AUTHOR}|7|`)).toEqual({
      author: AUTHOR,
      body: "",
    });
  });

  it("returns null for a different program's log", () => {
    expect(parsePostLog(`Program log: SOMETHING_ELSE|${AUTHOR}|7|hi`)).toBeNull();
  });

  it("returns null when the prefix isn't followed by a delimiter", () => {
    // "ANONBOARD_POSTX|..." must NOT match the "ANONBOARD_POST|" prefix.
    expect(parsePostLog(`${POST_LOG_PREFIX}X|${AUTHOR}|7|hi`)).toBeNull();
  });

  it("returns null when there are fewer than four fields", () => {
    expect(parsePostLog(`${POST_LOG_PREFIX}|${AUTHOR}|7`)).toBeNull();
    expect(parsePostLog(`${POST_LOG_PREFIX}|${AUTHOR}`)).toBeNull();
  });

  it("returns null for an unrelated log line", () => {
    expect(parsePostLog("Program log: Instruction: Transfer")).toBeNull();
    expect(parsePostLog("")).toBeNull();
  });
});
