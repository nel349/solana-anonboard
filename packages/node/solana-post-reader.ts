// Devnet Solana post reader. On devnet the SDK's Solana sync leg is disabled (it can't
// getBlock — public devnet bans it — and its catch-up grows unbounded), so this reads posts
// directly with the methods devnet serves: getSignaturesForAddress + getTransaction, indexes
// them (O(our posts)), and folds them into the posts table with the SAME arbiter rule as
// state-machine.ts's `solana-post` STF — a post counts only if its author holds a Midnight
// badge, with the cross-chain ordering race handled by an idempotent backfill each cycle.
//
// It runs as its own process with its own pglite connection (pglite accepts concurrent
// clients); the sync node keeps folding the Midnight badge set. Config via SOLANA_READER_* env.

import { getConnection, runPreparedQuery } from "@effectstream/db";
import {
  acceptPostsForAuthor,
  getBadge,
  insertPost,
  migrationTable,
  REASON_BADGE_VERIFIED,
  REASON_NO_BADGE,
} from "@solana-anonboard/database";
import { DevnetPostIndex, type ReaderRpc } from "./solana-post-reader-lib.ts";

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`solana-post-reader: ${name} is required`);
  return v;
};

const PORT = Number(process.env.SOLANA_READER_PORT ?? "8898");
const UPSTREAM = required("SOLANA_READER_UPSTREAM").replace(/\/+$/, "");
const PROGRAM_ID = required("SOLANA_READER_PROGRAM_ID");
const START_SLOT = Number(required("SOLANA_READER_START_SLOT"));
const REFRESH_MS = Number(process.env.SOLANA_READER_REFRESH_MS ?? "1000");

async function upstreamRpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(UPSTREAM, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { error?: unknown; result?: T };
  if (json.error) throw new Error(`upstream ${method}: ${JSON.stringify(json.error)}`);
  return json.result as T;
}

const rpc: ReaderRpc = {
  getSlot: () => upstreamRpc<number>("getSlot", [{ commitment: "confirmed" }]),
  getSignaturesForAddress: (program, opts) =>
    upstreamRpc("getSignaturesForAddress", [
      program,
      { limit: opts.limit, ...(opts.before ? { before: opts.before } : {}) },
    ]),
  async getTransaction(signature) {
    const tx = await upstreamRpc<{ meta: { logMessages: string[] | null } | null } | null>(
      "getTransaction",
      [signature, { maxSupportedTransactionVersion: 0, encoding: "json", commitment: "confirmed" }],
    );
    if (!tx) return null;
    return { meta: tx.meta ? { logMessages: tx.meta.logMessages ?? null } : null };
  },
};

const pool = getConnection();
const index = new DevnetPostIndex(rpc, PROGRAM_ID, START_SLOT);
let firstSweepDone = false;
let lastError = "";

// Idempotent CREATE TABLE IF NOT EXISTS — safe to run even though the sync node also ensures
// the same schema (pglite serializes across the two connections).
async function ensureSchema(): Promise<void> {
  for (const migration of migrationTable) {
    await pool.query(migration.sql);
  }
}

// One fold: index new posts, insert each with a point-in-time badge check, then backfill
// acceptance for any author whose badge has since arrived. Both are idempotent, so a post's
// accepted status is eventually correct regardless of which chain's event lands first.
async function fold(): Promise<void> {
  await index.refresh();
  const posts = index.posts();
  // One badge lookup per DISTINCT author (not per post).
  const badged = new Set<string>();
  for (const author of new Set(posts.map((p) => p.author))) {
    const badge = await runPreparedQuery(getBadge.run({ pubkey: author }, pool), "reader:getBadge");
    if (badge.length > 0) badged.add(author);
  }
  for (const post of posts) {
    const accepted = badged.has(post.author);
    await runPreparedQuery(
      insertPost.run(
        {
          author: post.author,
          body: post.body,
          slot: String(post.slot),
          block_height: 0, // no associated Midnight block; the reader sources this from Solana
          accepted,
          reason: accepted ? REASON_BADGE_VERIFIED : REASON_NO_BADGE,
        },
        pool,
      ),
      "reader:insertPost",
    );
  }
  // Backfill: a post first inserted before its author's badge synced stays accepted=false
  // (insertPost is DO-NOTHING, so a later true insert can't flip it). Once the badge is here,
  // accept it. Mirrors state-machine.ts's cross-chain race fix; idempotent.
  for (const author of badged) {
    await runPreparedQuery(acceptPostsForAuthor.run({ author }, pool), "reader:accept");
  }
}

async function loop(): Promise<void> {
  await ensureSchema();
  for (;;) {
    try {
      await fold();
      firstSweepDone = true;
      lastError = "";
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      console.error(`[solana-post-reader] fold failed: ${lastError}`);
    }
    await new Promise((r) => setTimeout(r, REFRESH_MS));
  }
}

// Health: 200 only once the first sweep has folded the existing posts, so the orchestrator's
// :wait (and the dev checklist) treat the reader as ready when posts are actually loaded.
const server = Bun.serve({
  port: PORT,
  fetch() {
    return firstSweepDone
      ? new Response("ok")
      : new Response(lastError ? `warming: ${lastError}` : "warming", { status: 503 });
  },
});

console.log(
  `[solana-post-reader] ${UPSTREAM} program ${PROGRAM_ID.slice(0, 8)}… from slot ${START_SLOT}; ` +
    `folding posts every ${REFRESH_MS}ms; health on http://127.0.0.1:${server.port}`,
);
void loop();
