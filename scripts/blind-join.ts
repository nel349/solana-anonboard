// Operator-blind join.
//
// The property to prove: the party that PAYS for and submits the join never
// sees the roster secret. This is what makes "the batcher/operator never sees
// the private input" real, and it is exactly what mn serve's
// balanceUnsealedTransaction does internally (balanceUnboundTransaction).
//
// Two scopes, sharing only a hex string:
//   PARTY A (has the member secret): builds the join, proves it locally with
//     the witness, and serializes an UnboundTransaction. The witness is
//     consumed by proving and is NOT in the serialized bytes.
//   PARTY B (has funds, NEVER receives the secret): a function that takes only
//     the unbound hex plus its own paying keys, balances + finalizes + submits.
//
// A fresh roster member is used (the owner already joined on this chain and the
// nullifier is one-shot). The member's public key is computed off-chain with
// the same persistentHash the circuit uses (verified against `owner`).

import path from "node:path";
import { fromHex, toHex } from "@midnight-ntwrk/midnight-js-utils";
import {
  buildWalletAndWaitForFunds,
  configureMidnightNodeProviders,
} from "@effectstream/midnight-contracts";
import {
  buildWalletFacade,
  syncAndWaitForFunds,
} from "@effectstream/midnight-contracts/wallet-info";
import { midnightNetworkConfig } from "@effectstream/midnight-contracts/midnight-env";
import { primeDustSnapshotViaMn } from "../packages/contracts-midnight/mn-dust-prime.ts";
import { readMidnightContract } from "@effectstream/midnight-contracts/read-contract";
import {
  createUnprovenCallTx,
  findDeployedContract,
} from "@midnight-ntwrk/midnight-js-contracts";
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { Transaction as LedgerTx } from "@midnight-ntwrk/ledger-v8";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  Anonboard,
  createAnonboardPrivateState,
  witnesses,
  deriveMemberPublicKey,
} from "../packages/contracts-midnight/contract-anonboard/src/_index.ts";
import { OWNER_SECRET_KEY } from "../packages/contracts-midnight/owner-key.ts";

const log = (s: string, m: string) => console.log(`\n[${s}] ${m}`);

// MEMBER_BYTE picks an unspent member each run — join burns a one-shot nullifier.
const MEMBER_SECRET_KEY = new Uint8Array(32);
MEMBER_SECRET_KEY[31] = Number(process.env.MEMBER_BYTE ?? "7");

async function main() {
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

  // Party B's paying keys — unrelated to the roster witness. Prime dust via mn's
  // fast indexer-direct reader (the SDK cold-sync never completes on preprod);
  // fall back to the SDK cold-sync if mn is unavailable. Only dust is spent, so
  // skip the shielded wait.
  log("setup", "building funded wallet (this wallet only ever pays fees)…");
  let w: Awaited<ReturnType<typeof buildWalletFacade>>;
  try {
    const snapshot = await primeDustSnapshotViaMn(
      midnightNetworkConfig.id,
      midnightNetworkConfig.walletSeed!,
      { log: (m) => log("mn", m), timeoutMs: 300_000 },
    );
    w = await buildWalletFacade(
      { id: midnightNetworkConfig.id, ...urls } as never,
      midnightNetworkConfig.walletSeed!,
      midnightNetworkConfig.id as never,
      "all" as never,
      snapshot,
    );
    await syncAndWaitForFunds(w.wallet as never, { skipShielded: true });
  } catch (e) {
    log("mn", `dust prime unavailable (${e instanceof Error ? e.message : String(e)}); SDK cold-sync`);
    w = await buildWalletAndWaitForFunds(
      urls as never,
      midnightNetworkConfig.walletSeed!,
      midnightNetworkConfig.id,
    );
  }
  const zkConfigPath = path.resolve(
    import.meta.dirname!,
    "..",
    "packages/contracts-midnight/contract-anonboard/src/managed",
  );
  const compiled = CompiledContract.make(
    "contract-anonboard",
    Anonboard.Contract as never,
  ).pipe(
    CompiledContract.withWitnesses(witnesses as never),
    CompiledContract.withCompiledFileAssets(zkConfigPath),
  );

  // Owner maintenance: add the member to the roster — not part of the blind flow.
  const adminProviders = configureMidnightNodeProviders(
    w.wallet,
    w.zswapSecretKeys,
    w.walletZswapSecretKeys,
    w.dustSecretKey,
    w.walletDustSecretKey,
    urls as never,
    "anonboard-admin-state",
    zkConfigPath,
    w.unshieldedKeystore,
  );
  const adminJoined = await findDeployedContract(adminProviders as never, {
    contractAddress: info.contractAddress,
    compiledContract: compiled as never,
    privateStateId: "anonboardAdminState",
    initialPrivateState: createAnonboardPrivateState(OWNER_SECRET_KEY),
  } as never);
  const memberPk = deriveMemberPublicKey(MEMBER_SECRET_KEY);
  const ledger0 = Anonboard.ledger(
    (await adminProviders.publicDataProvider.queryContractState(info.contractAddress))!.data,
  );
  if (!ledger0.roster.findPathForLeaf(memberPk)) {
    log("admin", `add_to_roster(member ${Buffer.from(memberPk).toString("hex").slice(0, 12)}…)`);
    await (adminJoined as any).callTx.add_to_roster(memberPk);
  } else {
    log("admin", "member already on roster");
  }

  // ── PARTY A: has the member secret. Build + prove the join locally. ──
  let badgePubkeyBytes: Uint8Array;
  let badgeLabel: string;
  if (process.env.BADGE_PUBKEY) {
    const pk = new PublicKey(process.env.BADGE_PUBKEY);
    badgePubkeyBytes = pk.toBytes();
    badgeLabel = pk.toBase58();
  } else {
    const badge = Keypair.generate();
    badgePubkeyBytes = badge.publicKey.toBytes();
    badgeLabel = badge.publicKey.toBase58();
    (await import("node:fs")).writeFileSync(
      path.resolve(import.meta.dirname!, "..", "poster.json"),
      JSON.stringify(Array.from(badge.secretKey)),
    );
  }
  const aProviders = configureMidnightNodeProviders(
    w.wallet,
    w.zswapSecretKeys,
    w.walletZswapSecretKeys,
    w.dustSecretKey,
    w.walletDustSecretKey,
    urls as never,
    "anonboard-memberA-state",
    zkConfigPath,
    w.unshieldedKeystore,
  );
  // Member secret becomes this contract's private state (the private$secret_key
  // witness reads it). setContractAddress first — the level provider is keyed by address.
  aProviders.privateStateProvider.setContractAddress(info.contractAddress);
  await aProviders.privateStateProvider.set(
    "anonboardMemberState",
    createAnonboardPrivateState(MEMBER_SECRET_KEY) as never,
  );
  log("party-A", `building unproven join(${badgeLabel.slice(0, 8)}…)`);
  const unproven = await createUnprovenCallTx(aProviders as never, {
    compiledContract: compiled as never,
    circuitId: "join" as never,
    contractAddress: info.contractAddress,
    args: [badgePubkeyBytes] as never,
    privateStateId: "anonboardMemberState",
  } as never);
  log("party-A", "proving locally (witness stays here)…");
  const unbound = await aProviders.proofProvider.proveTx(
    (unproven as any).private.unprovenTx,
  );
  const unboundHex = toHex(unbound.serialize());
  log("party-A", `proved. handing ${unboundHex.length / 2} bytes to the operator. No secret in them.`);

  // ── PARTY B: the operator. Receives ONLY the hex and its own paying keys.
  //    It never sees MEMBER_SECRET_KEY, OWNER_SECRET_KEY, or the witnesses. ──
  async function operatorPayAndSubmit(
    hex: string,
    payer: {
      wallet: typeof w.wallet;
      shieldedSecretKeys: typeof w.walletZswapSecretKeys;
      dustSecretKey: typeof w.walletDustSecretKey;
    },
  ): Promise<string> {
    const tx = LedgerTx.deserialize(
      "signature",
      "proof",
      "pre-binding",
      fromHex(hex),
    );
    const recipe = await payer.wallet.balanceUnboundTransaction(
      tx as never,
      {
        shieldedSecretKeys: payer.shieldedSecretKeys,
        dustSecretKey: payer.dustSecretKey,
      },
      { ttl: new Date(Date.now() + 5 * 60 * 1000) },
    );
    const finalized = await payer.wallet.finalizeRecipe(recipe as never);
    return String(await payer.wallet.submitTransaction(finalized as never));
  }

  log("party-B", "operator balances + finalizes + submits, using only its own dust keys…");
  const txid = await operatorPayAndSubmit(unboundHex, {
    wallet: w.wallet,
    shieldedSecretKeys: w.walletZswapSecretKeys,
    dustSecretKey: w.walletDustSecretKey,
  });
  log("party-B", `submitted ${txid.slice(0, 16)}…`);

  console.log(`
── operator-blind join complete ─────────────────────────────────
Party A proved the join with the member secret and produced a
${unboundHex.length / 2}-byte unbound transaction. Party B paid and submitted it
using only its own dust keys and never received the secret.

Badge to look for: ${badgeLabel}
Give the sync node ~30s, then: curl -s localhost:9999/api/badges | jq
─────────────────────────────────────────────────────────────────
`);
  process.exit(0);
}

main().catch((e) => {
  console.error("blind-join failed:", e);
  process.exit(1);
});
