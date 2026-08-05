// The demonstration this whole PoC exists to make.
//
//   1. Midnight: the owner adds itself to the roster, then calls `join` with a
//      freshly generated Solana public key. That mints an anonymous badge.
//      Nothing on chain records WHICH roster member the badge belongs to.
//   2. Solana: two posts. One signed by the badge key, one signed by a random
//      key that never joined.
//   3. The EffectStream state machine folds both chains and decides. The badge
//      holder's post is accepted; the stranger's is rejected.
//
// Run with the stack up: bun run scripts/demo.ts

import path from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  buildWalletAndWaitForFunds,
  configureMidnightNodeProviders,
} from "@effectstream/midnight-contracts";
import { midnightNetworkConfig } from "@effectstream/midnight-contracts/midnight-env";
import { readMidnightContract } from "@effectstream/midnight-contracts/read-contract";
import { findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createIncrementInstruction } from "@solana-starter/contracts-solana";
import {
  Anonboard,
  createAnonboardPrivateState,
  witnesses,
} from "../packages/contracts-midnight/contract-anonboard/src/_index.ts";
import { OWNER_SECRET_KEY } from "../packages/contracts-midnight/owner-key.ts";

const RPC = "http://localhost:8899";

function log(step: string, msg: string) {
  console.log(`\n[${step}] ${msg}`);
}

async function main() {
  // ── Midnight: mint an anonymous badge ────────────────────────────────
  const info = readMidnightContract("contract-anonboard", {
    networkId: midnightNetworkConfig.id,
  });
  if (!info.contractAddress) throw new Error("contract not deployed");
  // Must precede ANY wallet or contract operation.
  setNetworkId(midnightNetworkConfig.id);
  log("midnight", `contract ${info.contractAddress}`);

  const urls = {
    indexer: midnightNetworkConfig.indexer,
    indexerWS: midnightNetworkConfig.indexerWS,
    node: midnightNetworkConfig.node,
    proofServer: midnightNetworkConfig.proofServer,
  };

  log("midnight", "building wallet (syncs + waits for dust, slow on a cold chain)…");
  const w = await buildWalletAndWaitForFunds(
    urls as never,
    midnightNetworkConfig.walletSeed!,
    midnightNetworkConfig.id,
  );

  const zkConfigPath = path.resolve(
    import.meta.dirname!,
    "..",
    "packages/contracts-midnight/contract-anonboard/src/managed",
  );

  const providers = configureMidnightNodeProviders(
    w.wallet,
    w.zswapSecretKeys,
    w.walletZswapSecretKeys,
    w.dustSecretKey,
    w.walletDustSecretKey,
    urls as never,
    "anonboard-demo-state",
    zkConfigPath,
    w.unshieldedKeystore,
  );

  // findDeployedContract wants a CompiledContract, not `new X.Contract()`.
  const compiled = CompiledContract.make(
    "contract-anonboard",
    Anonboard.Contract as never,
  ).pipe(
    CompiledContract.withWitnesses(witnesses as never),
    CompiledContract.withCompiledFileAssets(zkConfigPath),
  );

  const joined = await findDeployedContract(providers as never, {
    contractAddress: info.contractAddress,
    compiledContract: compiled as never,
    privateStateId: "anonboardPrivateState",
    initialPrivateState: createAnonboardPrivateState(OWNER_SECRET_KEY),
  } as never);

  // Read `owner` off the public ledger so we can put it on the roster.
  const raw = await providers.publicDataProvider.queryContractState(
    info.contractAddress,
  );
  const ledger = Anonboard.ledger(raw!.data);
  const ownerPk = ledger.owner as Uint8Array;
  log("midnight", `owner pk ${Buffer.from(ownerPk).toString("hex").slice(0, 16)}…`);

  if (!ledger.roster.member(ownerPk)) {
    log("midnight", "add_to_roster(owner) …");
    await joined.callTx.add_to_roster(ownerPk);
    log("midnight", "roster updated");
  } else {
    log("midnight", "owner already on roster");
  }

  // The badge: a throwaway Solana keypair, bound to "some roster member".
  // Persisted so a second run can post from it again — `join` burns a
  // nullifier, so the same member can never mint a second badge.
  const badgeFile = path.resolve(import.meta.dirname!, "..", "badge.json");
  let badge: Keypair;
  if (existsSync(badgeFile)) {
    badge = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(badgeFile, "utf8"))),
    );
    log("midnight", `reusing badge ${badge.publicKey.toBase58()} (already joined)`);
  } else {
    badge = Keypair.generate();
    writeFileSync(badgeFile, JSON.stringify(Array.from(badge.secretKey)));
    log("midnight", `join(${badge.publicKey.toBase58()}) …`);
    await joined.callTx.join(badge.publicKey.toBytes());
    log("midnight", "badge minted — ledger records the key, not the person");
  }

  // ── Solana: two posts, one legitimate, one not ───────────────────────
  const conn = new Connection(RPC, "confirmed");
  const stranger = Keypair.generate();

  for (const [who, kp] of [
    ["BADGE HOLDER", badge],
    ["STRANGER", stranger],
  ] as const) {
    const sig = await conn.requestAirdrop(kp.publicKey, LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, "confirmed");
    const tx = new Transaction().add(
      createIncrementInstruction(kp.publicKey, 1, kp.publicKey),
    );
    const h = await sendAndConfirmTransaction(conn, tx, [kp], {
      commitment: "confirmed",
    });
    log("solana", `${who} posted — ${kp.publicKey.toBase58()} (${h.slice(0, 12)}…)`);
  }

  console.log(`
── what to check ────────────────────────────────────────────────
Give the sync node ~30s to fold both chains, then:

  curl -s localhost:9999/api/posts | jq

Expect the badge holder's post accepted:true and the stranger's
accepted:false. Badge:    ${badge.publicKey.toBase58()}
                Stranger: ${stranger.publicKey.toBase58()}
─────────────────────────────────────────────────────────────────
`);
  process.exit(0);
}

main().catch((e) => {
  console.error("demo failed:", e);
  process.exit(1);
});
