// Regression test for insertPost idempotency. A post's identity is (author, post_index) — the
// on-chain per-author counter value — so a re-fold of the same post must not duplicate the row,
// while genuinely distinct posts (different index) are kept. Runs the real migrations against an
// in-memory PGLite and exercises the actual uq_posts_identity + ON CONFLICT. Run: bun test.
import { describe, it, expect, beforeEach } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { migrationTable } from "../mod.ts";

// Mirrors sql/anonboard.ts insertPost (kept in sync deliberately — this test guards the schema
// constraint that makes that query idempotent).
const INSERT_POST =
  `INSERT INTO posts (author, body, slot, post_index, accepted, reason)
   VALUES ($1, $2, $3, $4, $5, $6)
   ON CONFLICT (author, post_index) DO NOTHING`;
const REJECTED = "no midnight badge";

let db: PGlite;
async function count(): Promise<number> {
  const r = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM posts");
  return r.rows[0].n;
}
async function insert(
  author: string,
  body: string,
  slot: number,
  index: number,
  accepted = false,
  reason = REJECTED,
) {
  await db.query(INSERT_POST, [author, body, slot, index, accepted, reason]);
}

describe("posts idempotency", () => {
  beforeEach(async () => {
    db = new PGlite();
    for (const m of migrationTable) await db.exec(m.sql);
  });

  it("re-folding the same (author, post_index) does not duplicate the row", async () => {
    await insert("alice", "hello", 5, 0);
    await insert("alice", "hello", 5, 0); // re-fold
    await insert("alice", "hello", 5, 0); // and again
    expect(await count()).toBe(1);
  });

  it("preserves a backfilled accepted status when the post is re-folded", async () => {
    await insert("alice", "hello", 5, 0); // arrives rejected (no badge yet)
    // backfill (mirrors acceptPostsForAuthor) once the badge syncs
    await db.query(
      `UPDATE posts SET accepted = true, reason = 'badge verified (backfilled)'
       WHERE author = $1 AND accepted = false AND reason = $2`,
      ["alice", REJECTED],
    );
    await insert("alice", "hello", 5, 0); // re-fold must NOT revert to rejected
    const r = await db.query<{ accepted: boolean; reason: string }>(
      "SELECT accepted, reason FROM posts WHERE author = 'alice'",
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].accepted).toBe(true);
    expect(r.rows[0].reason).toBe("badge verified (backfilled)");
  });

  it("keeps genuinely distinct posts (different index, or different author)", async () => {
    await insert("alice", "hello", 5, 0);
    await insert("alice", "hello", 6, 1); // same body, next index => distinct
    await insert("alice", "world", 7, 2); // different body, next index => distinct
    await insert("bob", "hello", 5, 0); // different author, same index => distinct
    expect(await count()).toBe(4);
  });

  it("accepts an oversized body (body is not in the unique index)", async () => {
    // The old (author, slot, md5(body)) index hashed the body to avoid the btree row limit.
    // With (author, post_index) the body isn't indexed at all, so a large body just inserts.
    const huge = Array.from(crypto.getRandomValues(new Uint8Array(9000)), (b) =>
      String.fromCharCode(33 + (b % 90)),
    ).join("");
    await insert("alice", huge, 5, 0);
    await insert("alice", huge, 5, 0); // re-fold de-dupes on (author, post_index)
    expect(await count()).toBe(1);
    const r = await db.query<{ body: string }>("SELECT body FROM posts WHERE author = 'alice'");
    expect(r.rows[0].body.length).toBe(9000);
  });
});
