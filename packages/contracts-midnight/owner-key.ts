// The roster owner key. On the local `undeployed` chain this defaults to a fixed,
// committed dev key so the demo runs out of the box. For any hosted network you must
// supply your own private key via MIDNIGHT_OWNER_KEY (64 hex chars = 32 bytes) — the
// committed one is public in the repo, so using it on a real chain would let anyone
// forge memberships.

const DEV_OWNER_KEY = new Uint8Array(32);
DEV_OWNER_KEY[31] = 0x01;

function parseHexKey(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error("MIDNIGHT_OWNER_KEY must be 64 hex characters (32 bytes).");
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// A real key from the environment wins; otherwise the committed dev key.
const envKey = process.env.MIDNIGHT_OWNER_KEY?.trim();
export const OWNER_SECRET_KEY = envKey ? parseHexKey(envKey) : DEV_OWNER_KEY;

// Safety guard: deploy + operator call this before using the key. The committed dev
// key may only touch the local `undeployed` chain. A hosted network is allowed only
// when a real MIDNIGHT_OWNER_KEY was supplied, so a single env flip can't silently
// make a public key the security model.
export function assertLocalOwnerKey(networkId: string): void {
  if (networkId === "undeployed") return;
  if (!envKey) {
    throw new Error(
      `Refusing to use the committed dev owner key on network "${networkId}". ` +
        `owner-key.ts is public in the repo, so anyone could forge memberships with it ` +
        `on a hosted chain. Set MIDNIGHT_OWNER_KEY to your own private key (64 hex), ` +
        `or use MIDNIGHT_NETWORK_ID=undeployed for the local demo.`,
    );
  }
}
