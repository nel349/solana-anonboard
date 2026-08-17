// Dev-only fixed owner key; a real deployment would generate one and keep it off the machine.
export const OWNER_SECRET_KEY = new Uint8Array(32);
OWNER_SECRET_KEY[31] = 0x01;

// Safety guard. This owner secret is committed to the repo, so anyone can recompute
// public_key(0x01) and call the owner-only add_to_roster. On the local `undeployed`
// chain that is harmless; on any hosted network (MIDNIGHT_NETWORK_ID=testnet/preview/
// preprod/mainnet) it would let anyone forge memberships. deploy + operator call this
// before using the key, so a single env flip can't silently make a public key the
// security model. A real deployment must supply its own private owner key.
export function assertLocalOwnerKey(networkId: string): void {
  if (networkId !== "undeployed") {
    throw new Error(
      `Refusing to use the committed dev owner key on network "${networkId}". ` +
        `owner-key.ts is public in the repo — on a hosted chain anyone could forge ` +
        `memberships with it. Use MIDNIGHT_NETWORK_ID=undeployed for the demo, or ` +
        `supply a real private owner key for a real deployment.`,
    );
  }
}
