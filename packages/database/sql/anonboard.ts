// Hand-built pgtyped queries for the anonboard tables.
//
// pgtyped's codegen needs a live database to introspect, which the PoC does
// not have at build time. `prepare()` derives the same IR shape from the SQL
// text. The loc convention was verified against the generated
// `queries.queries.ts` in this package: `a` is the index of the leading ':',
// `b` is the index of the token's last character, inclusive.

import { PreparedQuery } from "@pgtyped/runtime";

function prepare<P, R>(statement: string): PreparedQuery<P, R> {
  const usedParamSet: Record<string, boolean> = {};
  const byName = new Map<string, {
    name: string;
    required: boolean;
    transform: { type: "scalar" };
    locs: { a: number; b: number }[];
  }>();
  const params: unknown[] = [];

  const re = /:([a-zA-Z_][a-zA-Z0-9_]*)(!?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(statement)) !== null) {
    const name = m[1];
    const loc = { a: m.index, b: m.index + m[0].length - 1 };
    usedParamSet[name] = true;
    const existing = byName.get(name);
    if (existing) {
      existing.locs.push(loc);
    } else {
      const p = {
        name,
        required: m[2] === "!",
        transform: { type: "scalar" as const },
        locs: [loc],
      };
      byName.set(name, p);
      params.push(p);
    }
  }

  return new PreparedQuery<P, R>({ usedParamSet, params, statement } as never);
}

export interface IInsertBadgeParams {
  pubkey: string;
  block_height: number;
}
export interface IInsertBadgeResult {
  pubkey: string;
}
// RETURNING yields a row only on a real insert (empty on ON CONFLICT), so callers
// can tell a newly-seen badge from a re-fold of the same one.
export const insertBadge = prepare<IInsertBadgeParams, IInsertBadgeResult>(
  `INSERT INTO badges (pubkey, block_height)
VALUES (:pubkey!, :block_height!)
ON CONFLICT (pubkey) DO NOTHING
RETURNING pubkey`,
);

export interface IGetBadgeParams {
  pubkey: string;
}
export interface IGetBadgeResult {
  pubkey: string;
  block_height: number;
}
export const getBadge = prepare<IGetBadgeParams, IGetBadgeResult>(
  `SELECT pubkey, block_height FROM badges WHERE pubkey = :pubkey!`,
);

export interface IInsertPostParams {
  author: string;
  body: string;
  slot: number | string;
  post_index: number | string;
  accepted: boolean;
  reason: string;
}
// Idempotent: a re-fold of the same post must not create a duplicate row. DO NOTHING preserves
// the existing row, including any backfilled accepted status (see acceptPostsForAuthor). The
// conflict target is uq_posts_identity (author, post_index) — the on-chain primary key.
export const insertPost = prepare<IInsertPostParams, void>(
  `INSERT INTO posts (author, body, slot, post_index, accepted, reason)
VALUES (:author!, :body!, :slot!, :post_index!, :accepted!, :reason!)
ON CONFLICT (author, post_index) DO NOTHING`,
);

export interface IGetPostsResult {
  id: number;
  author: string;
  body: string;
  slot: string;
  post_index: string;
  accepted: boolean;
  reason: string;
}
export const getAllPosts = prepare<Record<string, never>, IGetPostsResult>(
  `SELECT id, author, body, slot, post_index, accepted, reason
FROM posts ORDER BY id DESC`,
);

// The reason written when a post's author has no badge yet. Single-sourced: the
// arbiter writes it (state-machine.ts) and the backfill below matches on it, so a
// drift would silently leave early posts rejected forever.
export const REASON_NO_BADGE = "no midnight badge";

// The reason written when a post's author holds a badge at fold time (accepted on sight).
export const REASON_BADGE_VERIFIED = "badge verified on midnight";

// Ordering race: Midnight syncs from block 1 while Solana is current, so a post
// can be rejected before its badge lands. Backfill those on badge arrival; idempotent.
export interface IAcceptPostsForAuthorParams {
  author: string;
}
export const acceptPostsForAuthor = prepare<IAcceptPostsForAuthorParams, void>(
  `UPDATE posts SET accepted = true, reason = 'badge verified (backfilled)'
WHERE author = :author! AND accepted = false AND reason = '${REASON_NO_BADGE}'`,
);

export interface IGetBadgesResult {
  pubkey: string;
  block_height: number;
}
export const getAllBadges = prepare<Record<string, never>, IGetBadgesResult>(
  `SELECT pubkey, block_height FROM badges ORDER BY pubkey`,
);
