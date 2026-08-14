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
export const insertBadge = prepare<IInsertBadgeParams, void>(
  `INSERT INTO badges (pubkey, block_height)
VALUES (:pubkey!, :block_height!)
ON CONFLICT (pubkey) DO NOTHING`,
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
  block_height: number;
  accepted: boolean;
  reason: string;
}
export const insertPost = prepare<IInsertPostParams, void>(
  `INSERT INTO posts (author, body, slot, block_height, accepted, reason)
VALUES (:author!, :body!, :slot!, :block_height!, :accepted!, :reason!)`,
);

export interface IGetPostsResult {
  id: number;
  author: string;
  body: string;
  slot: string;
  block_height: number;
  accepted: boolean;
  reason: string;
}
export const getAllPosts = prepare<Record<string, never>, IGetPostsResult>(
  `SELECT id, author, body, slot, block_height, accepted, reason
FROM posts ORDER BY id DESC`,
);

// Ordering race: Midnight syncs from block 1 while Solana is current, so a post
// can be rejected before its badge lands. Backfill those on badge arrival; idempotent.
export interface IAcceptPostsForAuthorParams {
  author: string;
}
export const acceptPostsForAuthor = prepare<IAcceptPostsForAuthorParams, void>(
  `UPDATE posts SET accepted = true, reason = 'badge verified (backfilled)'
WHERE author = :author! AND accepted = false AND reason = 'no midnight badge'`,
);

export interface IGetBadgesResult {
  pubkey: string;
  block_height: number;
}
export const getAllBadges = prepare<Record<string, never>, IGetBadgesResult>(
  `SELECT pubkey, block_height FROM badges ORDER BY pubkey`,
);
