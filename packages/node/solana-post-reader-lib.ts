// Pure core for the devnet Solana post reader (solana-post-reader.ts).
//
// Account-storage version: posts live in program-owned accounts (state), which devnet serves
// via getProgramAccounts + getAccountInfo (unlike getBlock, which it bans). The reader lists
// the post accounts and decodes them with decodePostAccount — the single source of the layout,
// in contracts-solana, that the program itself writes. Because only the program can write its
// own accounts, the author field is authoritative: there is no log/CPI spoofing surface, so
// no extractProgramLogs boundary is needed here.

import { decodePostAccount } from "@solana-anonboard/contracts-solana";

export type Post = { author: string; body: string; slot: number; index: number };

// Decode program accounts into posts, oldest-slot first (so DB insertion order → newest gets
// the highest id → newest-first in getAllPosts). Non-post accounts (e.g. counters) decode to
// null and are dropped.
export function postsFromAccounts(accounts: readonly { data: Uint8Array }[]): Post[] {
  const out: Post[] = [];
  for (const a of accounts) {
    const p = decodePostAccount(a.data);
    if (p) out.push({ author: p.author, body: p.body, slot: p.slot, index: p.index });
  }
  return out.sort((a, b) => a.slot - b.slot || a.author.localeCompare(b.author) || a.index - b.index);
}
