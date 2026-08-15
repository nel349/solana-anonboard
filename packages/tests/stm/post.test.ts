import { assert, assertSQL } from "../helpers.ts";
import { Keypair } from "@solana/web3.js";
import type { Client } from "pg";
import {
  buildAnonboardContext,
  freshMemberSecret,
  getSolBalance,
  operatorBlindJoin,
  queryLedger,
  sendPost,
} from "./anonboard.ts";

// Reason strings the state machine writes (packages/node/state-machine.ts):
//   rejected      → accepted=false, reason='no midnight badge'
//   accepted late → accepted=true,  reason='badge verified (backfilled)'
//   accepted now  → accepted=true,  reason='badge verified on midnight'
const REASON_NO_BADGE = "no midnight badge";
const REASON_BACKFILLED = "badge verified (backfilled)";

const JOIN_TIMEOUT = 120_000;
const POST_TIMEOUT = 60_000;

export interface PostTestResult {
  acceptedAuthor: string; // an author whose post is accepted (for the API test)
  joinedBadge: string; // the badge pubkey that appears in the badges table
}

export async function postTest(db: Client): Promise<PostTestResult> {
  console.log("  [info] building funded Midnight wallet (cold sync, be patient)…");
  const ctx = await buildAnonboardContext();

  // ── 1. Stranger post is rejected + feeless. ──
  const stranger = Keypair.generate();
  const strangerAddr = stranger.publicKey.toBase58();
  console.log(`  [info] stranger badge ${strangerAddr.slice(0, 8)}…`);

  await assert("stranger badge starts with zero SOL", async () => {
    return (await getSolBalance(strangerAddr)) === 0;
  });

  await assert("stranger post submitted through batcher (gasless)", async () => {
    await sendPost(stranger, "i never joined but here i am");
    return true;
  });

  await assertSQL<{ accepted: boolean; reason: string }>(
    "stranger post recorded accepted=false reason='no midnight badge'",
    db,
    `SELECT accepted, reason FROM posts WHERE author = '${strangerAddr}' ORDER BY id DESC LIMIT 1;`,
    (res) => res.rows.length >= 1,
    (res) => res.rows[0].accepted === false && res.rows[0].reason === REASON_NO_BADGE,
    POST_TIMEOUT,
  );

  await assert("stranger still has zero SOL after posting (fully feeless)", async () => {
    return (await getSolBalance(strangerAddr)) === 0;
  });

  // ── 2. Late join backfills the earlier post (the cross-chain ordering gap). ──
  const memberSecret = freshMemberSecret();
  const badgeB = Keypair.generate();
  const badgeBAddr = badgeB.publicKey.toBase58();
  console.log(`  [info] member badge B ${badgeBAddr.slice(0, 8)}…`);

  await assert("badge B posts BEFORE joining → submitted through batcher", async () => {
    await sendPost(badgeB, "posting before my badge is minted");
    return true;
  });

  await assertSQL<{ accepted: boolean; reason: string }>(
    "badge B's early post is initially rejected (no badge yet)",
    db,
    `SELECT accepted, reason FROM posts WHERE author = '${badgeBAddr}' ORDER BY id DESC LIMIT 1;`,
    (res) => res.rows.length >= 1,
    (res) => res.rows[0].accepted === false && res.rows[0].reason === REASON_NO_BADGE,
    POST_TIMEOUT,
  );

  await assert("operator-blind join of badge B (owner never sees the secret)", async () => {
    await operatorBlindJoin(ctx, memberSecret, badgeB.publicKey);
    return true;
  });

  await assertSQL<{ pubkey: string }>(
    "badge B appears in the badges table after the join syncs",
    db,
    `SELECT pubkey FROM badges WHERE pubkey = '${badgeBAddr}';`,
    (res) => res.rows.length >= 1,
    (res) => res.rows[0].pubkey === badgeBAddr,
    JOIN_TIMEOUT,
  );

  await assertSQL<{ accepted: boolean; reason: string }>(
    "badge B's earlier post is BACKFILLED to accepted=true",
    db,
    `SELECT accepted, reason FROM posts WHERE author = '${badgeBAddr}' ORDER BY id ASC LIMIT 1;`,
    (res) => res.rows.length >= 1 && res.rows[0].accepted === true,
    (res) => res.rows[0].accepted === true && res.rows[0].reason === REASON_BACKFILLED,
    JOIN_TIMEOUT,
  );

  // ── 3. A member post is now accepted directly. ──
  await assert("badge B posts again AFTER joining → submitted through batcher", async () => {
    await sendPost(badgeB, "now i am a verified member");
    return true;
  });

  await assertSQL<{ accepted: boolean }>(
    "badge B's later post is accepted directly (a new accepted row exists)",
    db,
    `SELECT accepted FROM posts WHERE author = '${badgeBAddr}' AND accepted = true;`,
    (res) => res.rows.length >= 2, // backfilled early post + this new one
    (res) => res.rows.length >= 2,
    POST_TIMEOUT,
  );

  // ── 4. One badge per member: the nullifier is one-shot. ──
  // Reuse the SAME member secret with a DIFFERENT badge; the circuit's nullifier
  // check must reject it. Do not swallow the failure.
  const badgeC = Keypair.generate();
  await assert("second join reusing the same member secret FAILS (one-shot nullifier)", async () => {
    let threw = false;
    try {
      await operatorBlindJoin(ctx, memberSecret, badgeC.publicKey);
    } catch {
      threw = true;
    }
    if (!threw) return false;
    // And prove the rejection is real: badge C never landed in the ledger/DB.
    const res = await db.query(
      `SELECT pubkey FROM badges WHERE pubkey = '${badgeC.publicKey.toBase58()}';`,
    );
    return res.rows.length === 0;
  });

  // ── 5. Privacy invariant: the nullifier map is unexported. ──
  await assert("deployed ledger exposes roster/badges/badge_count but NOT 'used'", async () => {
    const ledger = await queryLedger(ctx);
    const hasPublic =
      "roster" in ledger && "badges" in ledger && "badge_count" in ledger;
    const hidesNullifier = !("used" in ledger);
    return hasPublic && hidesNullifier;
  });

  return { acceptedAuthor: badgeBAddr, joinedBadge: badgeBAddr };
}
