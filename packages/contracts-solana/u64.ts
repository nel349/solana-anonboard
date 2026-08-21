// Browser-safe little-endian u64 <-> bytes. The `buffer` polyfill in the frontend bundle does
// NOT implement Buffer.writeBigUInt64LE / readBigUInt64LE (they exist only in Node), so those
// throw "not a function" in the browser. Doing the bytes by hand works everywhere and is
// byte-identical to Rust's u64::to_le_bytes / from_le_bytes.
export function u64leBytes(n: number): Uint8Array {
  const out = new Uint8Array(8);
  let v = BigInt(n);
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export function u64leNumber(bytes: Uint8Array, offset = 0): number {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(bytes[offset + i]);
  return Number(v);
}
