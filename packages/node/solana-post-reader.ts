// Devnet Solana post reader — account-storage version. On devnet the SDK's Solana leg is off
// (it can't getBlock), so this lists the program's post accounts with getProgramAccounts
// (served on devnet), decodes them, and folds them into the posts table with the SAME arbiter
// rule as state-machine.ts's solana-post STF (accepted = author holds a Midnight badge), plus
// an idempotent backfill for the cross-chain race. Reading state means no history scan and no
// start slot — a restart just re-lists the accounts. Runs as its own process with its own
// pglite connection. Config via SOLANA_READER_* env.

import { Buffer } from "node:buffer";
import { getConnection, runPreparedQuery } from "@effectstream/db";
import {
  acceptPostsForAuthor,
  getBadge,
  insertPost,
  migrationTable,
  REASON_BADGE_VERIFIED,
  REASON_NO_BADGE,
} from "@solana-anonboard/database";
import { MAX_BODY, POST_LAYOUT } from "@solana-anonboard/contracts-solana";
import { postsFromAccounts } from "./solana-post-reader-lib.ts";

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`solana-post-reader: ${name} is required`);
  return v;
};

const PORT = Number(process.env.SOLANA_READER_PORT ?? "8898");
const UPSTREAM = required("SOLANA_READER_UPSTREAM").replace(/\/+$/, "");
const PROGRAM_ID = required("SOLANA_READER_PROGRAM_ID");
const REFRESH_MS = Number(process.env.SOLANA_READER_REFRESH_MS ?? "1000");

// Post accounts are exactly this size (counter accounts are smaller) — filter to them upstream.
const POST_SIZE = POST_LAYOUT.body + MAX_BODY;

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

async function fetchPostAccounts(): Promise<{ data: Uint8Array }[]> {
  const res = await upstreamRpc<{ account: { data: [string, string] } }[]>("getProgramAccounts", [
    PROGRAM_ID,
    { encoding: "base64", filters: [{ dataSize: POST_SIZE }] },
  ]);
  return res.map((r) => ({ data: Uint8Array.from(Buffer.from(r.account.data[0], "base64")) }));
}

const pool = getConnection();
let firstSweepDone = false;
let lastError = "";

// Idempotent CREATE TABLE IF NOT EXISTS — safe alongside the sync node (pglite serializes).
async function ensureSchema(): Promise<void> {
  for (const migration of migrationTable) await pool.query(migration.sql);
}

// One fold: list post accounts, insert each with a point-in-time badge check, then backfill
// acceptance for any author whose badge has since arrived. Both idempotent, so a post's
// accepted status is eventually correct regardless of which chain's event lands first.
async function fold(): Promise<void> {
  const posts = postsFromAccounts(await fetchPostAccounts());
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

// Health: 200 only once the first sweep has folded the existing posts.
const server = Bun.serve({
  port: PORT,
  fetch() {
    return firstSweepDone
      ? new Response("ok")
      : new Response(lastError ? `warming: ${lastError}` : "warming", { status: 503 });
  },
});

console.log(
  `[solana-post-reader] ${UPSTREAM} program ${PROGRAM_ID.slice(0, 8)}… ` +
    `(getProgramAccounts, dataSize ${POST_SIZE}); folding posts every ${REFRESH_MS}ms; ` +
    `health on http://127.0.0.1:${server.port}`,
);
void loop();
