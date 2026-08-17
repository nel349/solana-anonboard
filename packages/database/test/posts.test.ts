// Regression test for insertPost idempotency (issue: a re-delivered Solana log —
// reorg / re-sync against a retained DB — used to insert duplicate post rows) and
// for the oversized-body crash (a >2700-byte body used to blow the btree row limit
// and wedge the sync). Runs the real migrations against an in-memory PGLite and
// exercises the actual uq_posts_identity (author, slot, md5(body)) + ON CONFLICT
// behavior. Run: bun test (this package).
import { describe, it, expect, beforeEach } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { migrationTable } from "../mod.ts";

// Mirrors sql/anonboard.ts insertPost (kept in sync deliberately — this test
// guards the schema constraint that makes that query idempotent).
const INSERT_POST =
  `INSERT INTO posts (author, body, slot, block_height, accepted, reason)
   VALUES ($1, $2, $3, $4, $5, $6)
   ON CONFLICT (author, slot, md5(body)) DO NOTHING`;
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
  accepted = false,
  reason = REJECTED,
) {
  await db.query(INSERT_POST, [author, body, slot, 1, accepted, reason]);
}

describe("posts idempotency", () => {
  beforeEach(async () => {
    db = new PGlite();
    for (const m of migrationTable) await db.exec(m.sql);
  });

  it("re-delivering the same (author, slot, body) does not duplicate the row", async () => {
    await insert("alice", "hello", 5);
    await insert("alice", "hello", 5); // reorg re-delivery
    await insert("alice", "hello", 5); // and again
    expect(await count()).toBe(1);
  });

  it("preserves a backfilled accepted status when the log is re-delivered", async () => {
    await insert("alice", "hello", 5); // arrives rejected (no badge yet)
    // backfill (mirrors acceptPostsForAuthor) once the badge syncs
    await db.query(
      `UPDATE posts SET accepted = true, reason = 'badge verified (backfilled)'
       WHERE author = $1 AND accepted = false AND reason = $2`,
      ["alice", REJECTED],
    );
    await insert("alice", "hello", 5); // re-delivery must NOT revert to rejected
    const r = await db.query<{ accepted: boolean; reason: string }>(
      "SELECT accepted, reason FROM posts WHERE author = 'alice'",
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].accepted).toBe(true);
    expect(r.rows[0].reason).toBe("badge verified (backfilled)");
  });

  it("keeps genuinely distinct posts (different slot, or same body different slot)", async () => {
    await insert("alice", "hello", 5);
    await insert("alice", "hello", 6); // same body, different slot => distinct
    await insert("alice", "world", 5); // different body, same slot => distinct
    await insert("bob", "hello", 5); // different author => distinct
    expect(await count()).toBe(4);
  });

  it("accepts an oversized body without wedging (hashed index, no btree row-limit)", async () => {
    // A raw btree over (author, slot, body) threw SQLSTATE 54000 past ~2700 bytes,
    // aborting the block tx and crash-looping the sync. The body MUST be
    // incompressible to reproduce it — a repeated char TOASTs down under the limit
    // and inserts even on the old index, so this uses random printable bytes.
    // Hashing the body in the index fixes it: a 9 KB post inserts and round-trips.
    const incompressible = (n: number) =>
      Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => String.fromCharCode(33 + (b % 90))).join("");
    const huge = incompressible(9000);
    await insert("alice", huge, 5);
    await insert("alice", huge, 5); // re-delivery still de-dupes on md5(body)
    expect(await count()).toBe(1);
    const r = await db.query<{ body: string }>("SELECT body FROM posts WHERE author = 'alice'");
    expect(r.rows[0].body.length).toBe(9000);

    // two different oversized bodies at the same (author, slot) stay distinct
    await insert("alice", incompressible(9000), 5);
    expect(await count()).toBe(2);
  });
});
