// Solana post reader — account-storage version; runs on both local and devnet. The SDK's
// Solana sync leg is gone (it needs getBlock, banned on public devnet), so this is the SOLE
// post-ingestion path: it lists the program's post accounts with getProgramAccounts (served on
// devnet), decodes them, and folds them into the posts table with the arbiter rule
// (accepted = author holds a Midnight badge), plus an idempotent backfill for the cross-chain
// race. Reading state means no history scan and no start slot — a restart just re-lists the
// accounts. Runs as its own process with its own pglite connection. Config via SOLANA_READER_* env.

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
          post_index: post.index, // the on-chain per-author index — the DB identity
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// A refused TCP connect often surfaces as an AggregateError whose own `message` is ""
// (the real reasons sit in `.errors`) — naively printing `e.message` yields an empty
// string, which is exactly how this process once "failed with no error". Dig the
// meaningful text out of aggregate/cause chains and error codes.
function describeError(e: unknown): string {
  if (e instanceof AggregateError && e.errors.length > 0) {
    return [...new Set(e.errors.map(describeError))].join("; ");
  }
  if (e instanceof Error) {
    const code = (e as { code?: string }).code;
    if (e.message) return code && !e.message.includes(code) ? `${e.message} (${code})` : e.message;
    if (code) return `${e.name}: ${code}`;
    if (e.cause !== undefined) return `${e.name}: ${describeError(e.cause)}`;
    return e.name;
  }
  return String(e);
}

// Print a fatal error on BOTH streams before exiting. stdout demonstrably reaches the
// orchestrator log (the startup banner does); relying on a single stream is how this
// process once died with nothing in .dev.log. Never let a rejection escape to
// @effectstream/db's process-global unhandledRejection handler — it logs only to a
// remote sink and exits, which is invisible in a terminal.
function fatal(context: string, e: unknown): never {
  const msg = `[solana-post-reader] FATAL ${context}: ${describeError(e)}` +
    (e instanceof Error && e.stack ? `\n${e.stack}` : "");
  console.log(msg);
  console.error(msg);
  process.exit(1);
}

// The reader can win the race against the PGLite server at boot (its wait step probes
// the port, not a working connection), so the first DB touch retries with the reason
// logged and surfaced via the health endpoint — bounded, then a loud fatal.
const DB_RETRY_MS = Number(process.env.SOLANA_READER_DB_RETRY_MS ?? "2000");
const DB_RETRY_MAX = Number(process.env.SOLANA_READER_DB_RETRY_MAX ?? "60"); // ~2 min
// A connect can also HANG (a non-Postgres process squatting the port swallows the
// handshake — the query neither resolves nor rejects), so each attempt gets a deadline.
const DB_ATTEMPT_TIMEOUT_MS = 10_000;
async function waitForDatabase(): Promise<void> {
  for (let attempt = 1; attempt <= DB_RETRY_MAX; attempt++) {
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `no reply from the database in ${DB_ATTEMPT_TIMEOUT_MS / 1000}s — is a non-Postgres process holding the port?`,
              ),
            ),
          DB_ATTEMPT_TIMEOUT_MS,
        );
      });
      await Promise.race([ensureSchema(), deadline]).finally(() => clearTimeout(timer));
      return;
    } catch (e) {
      lastError = describeError(e);
      console.log(
        `[solana-post-reader] waiting for database (${attempt}/${DB_RETRY_MAX}): ${lastError}`,
      );
      await sleep(DB_RETRY_MS);
    }
  }
  throw new Error(
    `database unreachable after ${(DB_RETRY_MAX * DB_RETRY_MS) / 1000}s — last error: ${lastError}`,
  );
}

async function loop(): Promise<void> {
  await waitForDatabase();
  for (;;) {
    try {
      await fold();
      firstSweepDone = true;
      lastError = "";
    } catch (e) {
      lastError = describeError(e);
      console.error(`[solana-post-reader] fold failed: ${lastError}`);
    }
    await sleep(REFRESH_MS);
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
loop().catch((e: unknown) => fatal("reader stopped", e));
