// Pure parsing/normalization for the arbiter — no side effects, unit-tested in
// test/log-parse.test.ts. A bug in either of these looks identical to "nobody has
// a badge" (a very quiet failure), so they're isolated here and covered directly.
import bs58 from "bs58";

export const POST_LOG_PREFIX = "ANONBOARD_POST";

// Midnight stores a badge as Bytes<32> (hex); Solana logs the signer as base58.
// Normalise to base58 so the arbiter compares like with like. Returns null for
// anything that isn't exactly 32 bytes of hex (with or without a "0x" prefix).
export function hexToBase58(hex: string): string | null {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length !== 64 || !/^[0-9a-fA-F]+$/.test(clean)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bs58.encode(bytes);
}

// ANONBOARD_POST|<author>|<slot>|<body>. Body is last and may itself contain '|',
// so split only the first three fields and keep the remainder as the body. A
// "Program log: " prefix (Solana's log framing) is stripped first. Returns null
// for any line that isn't one of our post logs.
export function parsePostLog(
  raw: string,
): { author: string; body: string } | null {
  const line = raw.startsWith("Program log: ")
    ? raw.slice("Program log: ".length)
    : raw;
  if (!line.startsWith(POST_LOG_PREFIX + "|")) return null;
  const parts = line.split("|");
  if (parts.length < 4) return null;
  return { author: parts[1], body: parts.slice(3).join("|") };
}
