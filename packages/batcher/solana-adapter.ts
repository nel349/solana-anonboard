import { SolanaAdapter } from "@effectstream/batcher-sdk";
import type { SolanaAdapterConfig } from "@effectstream/batcher-sdk";
import fs from "node:fs";
import path from "node:path";
import bs58 from "bs58";

/**
 * Build a `SolanaAdapter` (fee-payer sponsor) for the dev environment: the
 * sponsor co-signs a user-partial tx so the user pays 0 SOL.
 *
 * The dev keypair is committed and its secret is public — for mainnet, load it
 * from a secret manager and never commit the file.
 */
export interface SolanaAdapterEnv {
  rpcUrl: string;
  /** Path to a Solana keypair JSON file ( array of 64 bytes ). */
  batcherKeypairPath: string;
  syncProtocolName: string;
  targetProgramId: string;
  maxBatchSize?: number;
  /** Set true for programs where the sponsor funds PDA rent — anonboard's post program does (the sponsor pays each post account's rent), so it must be true; off only for pure log/transfer programs. */
  allowSponsorAsInstructionAccount?: boolean;
}

/**
 * Publicly-known dev fee-payer keys — must never fund a real network. The batcher
 * keypair is now generated per clone (gitignored), but this key was committed to the
 * template in git history, so anyone can recover it; it stays on the denylist so an old
 * checkout can't accidentally sponsor on a non-loopback RPC. Keyed by public key so a
 * copy under a different filename is still caught.
 */
const PUBLIC_DEV_KEYPAIRS = new Set([
  "3oFfnPdVbZZRapZTLgZ1ZDCmdf4YjGMpzDgukoWYpXqW", // historical committed batcher key (git history)
]);

function isLoopbackRpc(rpcUrl: string): boolean {
  try {
    const { hostname } = new URL(rpcUrl);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function loadBatcherSecretKey(keypairPath: string, rpcUrl: string): string {
  const resolved = path.resolve(process.cwd(), keypairPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `[batcher] Fee-payer keypair not found at ${resolved}. ` +
        `Generate one with \`solana-keygen new --outfile ${keypairPath}\`.`,
    );
  }
  // Keypair JSON is an array of 64 bytes: the first 32 are the private seed,
  // the last 32 the public key. The Solana SDK expects the full 64-byte secret
  // key in base58.
  const bytes = JSON.parse(fs.readFileSync(resolved, "utf-8")) as number[];
  if (bytes.length !== 64) {
    throw new Error(
      `[batcher] ${keypairPath} is ${bytes.length} bytes, expected 64. Regenerate it.`,
    );
  }
  const secretKey = Uint8Array.from(bytes);

  // Fail closed: a keypair whose secret is in the repo must not pay fees on a
  // network where those fees are real money.
  const pubkey = bs58.encode(secretKey.slice(32));
  if (PUBLIC_DEV_KEYPAIRS.has(pubkey) && !isLoopbackRpc(rpcUrl)) {
    throw new Error(
      `[batcher] Refusing to use the committed dev keypair ${pubkey} against ` +
        `a non-local RPC (${rpcUrl}). Its secret key is public — anyone with ` +
        `this repo can drain it. Generate your own:\n` +
        `  solana-keygen new --outfile ${keypairPath}`,
    );
  }

  return bs58.encode(secretKey);
}

export function createSolanaAdapter(env: SolanaAdapterEnv): SolanaAdapter {
  const config: SolanaAdapterConfig = {
    rpcUrl: env.rpcUrl,
    batcherSecretKey: loadBatcherSecretKey(env.batcherKeypairPath, env.rpcUrl),
    syncProtocolName: env.syncProtocolName,
    targetProgramId: env.targetProgramId,
    maxBatchSize: env.maxBatchSize,
    allowSponsorAsInstructionAccount: env.allowSponsorAsInstructionAccount,
  };
  return new SolanaAdapter(config);
}
