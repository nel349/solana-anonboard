// Pure normalization for the badge arbiter — no side effects, unit-tested in
// test/log-parse.test.ts. A bug here looks identical to "nobody has a badge" (a very
// quiet failure), so it is isolated here and covered directly.
import bs58 from "bs58";

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

