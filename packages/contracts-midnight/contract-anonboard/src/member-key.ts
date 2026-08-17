// Member identity commitment — the SINGLE source of the derivation the frontend,
// the headless join script, and the tests all need. It must stay byte-identical
// to the circuit's `public_key(sk)` (anonboard.compact): the value goes on the
// roster (add_to_roster) and is what a join proves membership of.
import {
  persistentHash,
  CompactTypeVector,
  CompactTypeBytes,
} from "@midnight-ntwrk/compact-runtime";

// pad(32, "..."): the ASCII bytes left-aligned in a 32-byte buffer, zero-padded.
function pad32(s: string): Uint8Array {
  const b = new Uint8Array(32);
  b.set(new TextEncoder().encode(s));
  return b;
}

// public_key(sk) = persistentHash<Vector<2, Bytes<32>>>([pad(32,"anonboard:pk:"), sk]).
export function deriveMemberPublicKey(secret: Uint8Array): Uint8Array {
  const t = new CompactTypeVector(2, new CompactTypeBytes(32));
  return persistentHash(t as never, [pad32("anonboard:pk:"), secret] as never);
}
