// Reusable test helpers for the anonboard membership/post flow.
//
// Two flows are extracted here so tests drive the real system in-process
// (never shelling out to scripts/):
//
//   operatorBlindJoin() — the operator-blind join from scripts/blind-join.ts:
//     owner add_to_roster(memberPk) → Party A proves join([badgePubkey])
//     locally with the member secret as private state → Party B
//     balanceUnboundTransaction + finalize + submit, NEVER seeing the secret.
//
//   sendPost() — the gasless post from scripts/gasless-post.ts: build a post
//     whose feePayer is the batcher sponsor, partialSign(poster), POST base64 +
//     userSig to the batcher /send-input. The author pays nothing.
//
// A single funded Midnight wallet is built once (buildAnonboardContext) and
// reused across every join to save time; each join takes fresh keys.

import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fromHex, toHex } from "@midnight-ntwrk/midnight-js-utils";
import {
  buildWalletAndWaitForFunds,
  configureMidnightNodeProviders,
} from "@effectstream/midnight-contracts";
import { midnightNetworkConfig } from "@effectstream/midnight-contracts/midnight-env";
import { readMidnightContract } from "@effectstream/midnight-contracts/read-contract";
import {
  createUnprovenCallTx,
  findDeployedContract,
} from "@midnight-ntwrk/midnight-js-contracts";
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { Transaction as LedgerTx } from "@midnight-ntwrk/ledger-v8";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import bs58 from "bs58";
import {
  Anonboard,
  createAnonboardPrivateState,
  witnesses,
  deriveMemberPublicKey,
} from "../../contracts-midnight/contract-anonboard/src/_index.ts";
import { OWNER_SECRET_KEY } from "../../contracts-midnight/owner-key.ts";
import {
  createPostInstruction,
  nextPostIndex,
  DEV_RPC_URL,
  DEV_BATCHER_URL,
  DEV_BATCHER_FEE_PAYER,
  DEV_BATCHER_TARGET,
} from "@solana-anonboard/contracts-solana";

// AddressType.SOLANA = 9 ( see @effectstream/utils ).
const ADDRESS_TYPE_SOLANA = 9;

const CONTRACT_DIR = path.resolve(
  import.meta.dirname!,
  "../../contracts-midnight",
);
const ZK_CONFIG_PATH = path.resolve(
  CONTRACT_DIR,
  "contract-anonboard/src/managed",
);

// A fresh 32-byte member secret (random) so its one-shot nullifier never
// collides across reruns against the persistent Midnight chain.
export function freshMemberSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export interface AnonboardContext {
  contractAddress: string;
  wallet: Awaited<ReturnType<typeof buildWalletAndWaitForFunds>>;
  compiled: ReturnType<typeof CompiledContract.make>;
  urls: {
    indexer: string;
    indexerWS: string;
    node: string;
    proofServer: string;
  };
  admin: {
    providers: ReturnType<typeof configureMidnightNodeProviders>;
    joined: { callTx: { add_to_roster(pk: Uint8Array): Promise<unknown> } };
  };
}

// Build the funded operator wallet + owner (admin) provider once. Slow on a
// cold chain (wallet sync + dust), so callers reuse the returned context.
export async function buildAnonboardContext(): Promise<AnonboardContext> {
  setNetworkId(midnightNetworkConfig.id);
  const info = readMidnightContract("contract-anonboard", {
    networkId: midnightNetworkConfig.id,
  });
  if (!info.contractAddress) throw new Error("contract not deployed");

  const urls = {
    indexer: midnightNetworkConfig.indexer,
    indexerWS: midnightNetworkConfig.indexerWS,
    node: midnightNetworkConfig.node,
    proofServer: midnightNetworkConfig.proofServer,
  };

  const wallet = await buildWalletAndWaitForFunds(
    urls as never,
    midnightNetworkConfig.walletSeed!,
    midnightNetworkConfig.id,
  );

  const compiled = CompiledContract.make(
    "contract-anonboard",
    Anonboard.Contract as never,
  ).pipe(
    CompiledContract.withWitnesses(witnesses as never),
    CompiledContract.withCompiledFileAssets(ZK_CONFIG_PATH),
  );

  // Owner maintenance provider: runs add_to_roster and reads the ledger.
  const adminProviders = configureMidnightNodeProviders(
    wallet.wallet,
    wallet.zswapSecretKeys,
    wallet.walletZswapSecretKeys,
    wallet.dustSecretKey,
    wallet.walletDustSecretKey,
    urls as never,
    "anonboard-admin-state",
    ZK_CONFIG_PATH,
    wallet.unshieldedKeystore,
  );
  const adminJoined = await findDeployedContract(adminProviders as never, {
    contractAddress: info.contractAddress,
    compiledContract: compiled as never,
    privateStateId: "anonboardAdminState",
    initialPrivateState: createAnonboardPrivateState(OWNER_SECRET_KEY),
  } as never);

  return {
    contractAddress: info.contractAddress,
    wallet,
    compiled: compiled as never,
    urls,
    admin: { providers: adminProviders, joined: adminJoined as any },
  };
}

// Read the on-chain ledger. Anonboard.ledger(state) exposes roster / badges /
// badge_count / owner; the `used` nullifier map is deliberately unexported.
export async function queryLedger(ctx: AnonboardContext): Promise<any> {
  const raw = await ctx.admin.providers.publicDataProvider.queryContractState(
    ctx.contractAddress,
  );
  if (!raw) throw new Error("contract state not found");
  return Anonboard.ledger(raw.data);
}

// Operator-blind join. Party A holds the member secret and proves join locally;
// Party B (the funded wallet) only pays + submits and never sees the secret.
// Throws if the circuit rejects (e.g. one-shot nullifier already spent).
export async function operatorBlindJoin(
  ctx: AnonboardContext,
  memberSecret: Uint8Array,
  badgePubkey: PublicKey,
): Promise<string> {
  const memberPk = deriveMemberPublicKey(memberSecret);

  // ── Owner maintenance: put the member on the roster (idempotent). ──
  const ledger = await queryLedger(ctx);
  if (!ledger.roster.findPathForLeaf(memberPk)) {
    await ctx.admin.joined.callTx.add_to_roster(memberPk);
  }

  // ── PARTY A: has the member secret. Build + prove the join locally. ──
  // Unique private-state id per member so reused providers never collide.
  const memberStateId = `anonboardMember_${Buffer.from(memberPk)
    .toString("hex")
    .slice(0, 16)}`;
  const aProviders = configureMidnightNodeProviders(
    ctx.wallet.wallet,
    ctx.wallet.zswapSecretKeys,
    ctx.wallet.walletZswapSecretKeys,
    ctx.wallet.dustSecretKey,
    ctx.wallet.walletDustSecretKey,
    ctx.urls as never,
    "anonboard-test-memberstate",
    ZK_CONFIG_PATH,
    ctx.wallet.unshieldedKeystore,
  );
  // The member secret becomes this contract's private state — the
  // private$secret_key witness reads it. setContractAddress first: the level
  // provider is keyed by address.
  aProviders.privateStateProvider.setContractAddress(ctx.contractAddress);
  await aProviders.privateStateProvider.set(
    memberStateId,
    createAnonboardPrivateState(memberSecret) as never,
  );

  const unproven = await createUnprovenCallTx(aProviders as never, {
    compiledContract: ctx.compiled as never,
    circuitId: "join" as never,
    contractAddress: ctx.contractAddress,
    args: [badgePubkey.toBytes()] as never,
    privateStateId: memberStateId,
  } as never);

  // Proving executes the circuit's asserts (roster membership + one-shot
  // nullifier). A spent nullifier throws here, before any bytes leave Party A.
  const unbound = await aProviders.proofProvider.proveTx(
    (unproven as any).private.unprovenTx,
  );
  const unboundHex = toHex(unbound.serialize());

  // ── PARTY B: the operator. Receives ONLY the hex + its own paying keys. ──
  const tx = LedgerTx.deserialize(
    "signature",
    "proof",
    "pre-binding",
    fromHex(unboundHex),
  );
  const recipe = await ctx.wallet.wallet.balanceUnboundTransaction(
    tx as never,
    {
      shieldedSecretKeys: ctx.wallet.walletZswapSecretKeys,
      dustSecretKey: ctx.wallet.walletDustSecretKey,
    },
    { ttl: new Date(Date.now() + 5 * 60 * 1000) },
  );
  const finalized = await ctx.wallet.wallet.finalizeRecipe(recipe as never);
  return String(await ctx.wallet.wallet.submitTransaction(finalized as never));
}

async function rpc(method: string, params: unknown[] = []) {
  const res = await fetch(DEV_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await res.json()).result;
}

export async function getSolBalance(pubkey: string): Promise<number> {
  const bal = await rpc("getBalance", [pubkey]);
  return bal?.value ?? 0;
}

// Gasless post through the batcher. The poster holds ZERO SOL: feePayer is the
// batcher sponsor, the poster only signs its own authority, and the batcher
// co-signs + submits. wait-effectstream-processed blocks until the sync has
// folded the post, so the DB reflects it once this resolves.
// The local batcher/sponsor pubkey: read from the (generated-on-first-run) keypair, falling back
// to the committed dev constant — keeps the test correct whether the key is generated or preexisting.
function localBatcherFeePayer(): PublicKey {
  const p =
    process.env.SOLANA_BATCHER_KEYPAIR ??
    path.resolve(import.meta.dirname!, "../../batcher/keypair/batcher-wallet.json");
  if (existsSync(p)) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8")))).publicKey;
  }
  return new PublicKey(DEV_BATCHER_FEE_PAYER);
}

export async function sendPost(poster: Keypair, body: string): Promise<void> {
  const conn = new Connection(DEV_RPC_URL, "confirmed");
  const sponsor = localBatcherFeePayer();
  const { blockhash } = await conn.getLatestBlockhash("confirmed");

  const tx = new Transaction();
  tx.feePayer = sponsor;
  tx.recentBlockhash = blockhash;
  const index = await nextPostIndex(conn, poster.publicKey);
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
  tx.add(createPostInstruction(poster.publicKey, sponsor, index, body));

  tx.partialSign(poster);
  const base64 = tx
    .serialize({ requireAllSignatures: false })
    .toString("base64");
  const userSig = tx.signatures.find((s) =>
    s.publicKey.equals(poster.publicKey),
  )?.signature;

  const res = await fetch(`${DEV_BATCHER_URL}/send-input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: {
        target: DEV_BATCHER_TARGET,
        addressType: ADDRESS_TYPE_SOLANA,
        address: poster.publicKey.toBase58(),
        signature: userSig ? bs58.encode(userSig) : "",
        input: base64,
        timestamp: Date.now().toString(),
      },
      confirmationLevel: "wait-effectstream-processed",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Batcher /send-input ${res.status}: ${text}`);
  }
}
