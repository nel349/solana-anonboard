// Pure core for the devnet Solana post reader (solana-post-reader.ts). All I/O is injected,
// so the index + post extraction are unit-testable without a network.
//
// Why this exists: the EffectStream Solana sync reads history via getBlock(slot), scanning
// every slot from a fixed start — and public devnet BANS getBlock (429 on every call), so on
// devnet that leg can't read our posts AND its catch-up distance grows unbounded as the chain
// ages. Instead, on devnet we drop the SDK's Solana leg and read posts directly with the two
// methods devnet DOES serve: getSignaturesForAddress (only OUR program's txs — O(our posts))
// + getTransaction (their logs). This indexes them and extracts posts with the SAME
// authorization boundary the SDK uses (extractProgramLogs), so a CPI can't spoof a post.

// Reused from the SDK's internal path (not a public export) rather than re-implemented, so the
// anti-spoof frame-attribution stays byte-identical to the SDK's own Solana leg — a copy could
// drift. If the SDK moves this file the import breaks loudly at compile time, never silently.
import { extractProgramLogs } from "../../node_modules/@effectstream/sync/src/sync-protocols/solana/program-logs.ts";
import { parsePostLog } from "./log-parse.ts";

export type IndexedTx = {
  signature: string;
  slot: number;
  logMessages: string[];
};

export type Post = { author: string; body: string; slot: number; signature: string };

// Injected RPC surface: real impls hit devnet; tests pass stubs.
export type ReaderRpc = {
  getSlot(): Promise<number>;
  // newest-first, paginated with `before`; each entry carries its slot + err.
  getSignaturesForAddress(
    program: string,
    opts: { before?: string; limit: number },
  ): Promise<{ signature: string; slot: number; err: unknown | null }[]>;
  getTransaction(
    signature: string,
  ): Promise<{ meta: { logMessages: string[] | null } | null } | null>;
};

const PAGE = 1000; // getSignaturesForAddress max page

// Extract every genuine post the program emitted in a transaction. extractProgramLogs is the
// SDK's authorization boundary: it returns only the lines OUR program's own frame emitted, so
// a CPI to another program that echoes "ANONBOARD_POST|…" is NOT attributed to us.
export function extractPosts(tx: IndexedTx, programId: string): Post[] {
  const programLogs = extractProgramLogs(tx.logMessages, programId);
  if (!programLogs) return [];
  const out: Post[] = [];
  for (const line of programLogs) {
    const p = parsePostLog(line);
    if (p) out.push({ author: p.author, body: p.body, slot: tx.slot, signature: tx.signature });
  }
  return out;
}

export class DevnetPostIndex {
  private readonly txs = new Map<string, IndexedTx>(); // by signature, idempotent
  private readonly seenSigs = new Set<string>();

  constructor(
    private readonly rpc: ReaderRpc,
    private readonly programId: string,
    private readonly startSlot: number,
  ) {}

  // Pull every new program signature down to startSlot (or the newest already-seen sig),
  // fetch each new tx, and record its logs. Idempotent: known sigs stop the sweep (sigs are
  // chronological, so a seen sig means everything older is already indexed).
  async refresh(): Promise<void> {
    let before: string | undefined;
    let done = false;
    while (!done) {
      const page = await this.rpc.getSignaturesForAddress(this.programId, { before, limit: PAGE });
      if (page.length === 0) break;
      for (const s of page) {
        if (s.slot < this.startSlot || this.seenSigs.has(s.signature)) {
          done = true;
          break;
        }
        this.seenSigs.add(s.signature);
        if (s.err) continue; // reverted tx: no on-chain effect
        const tx = await this.rpc.getTransaction(s.signature);
        const logs = tx?.meta?.logMessages;
        if (!tx || !logs) continue;
        this.txs.set(s.signature, { signature: s.signature, slot: s.slot, logMessages: logs });
      }
      before = page[page.length - 1]?.signature;
      if (page.length < PAGE) break; // reached the oldest signature
    }
  }

  // Every post known so far, oldest slot first (so DB insertion order → newest gets the
  // highest id → newest-first in getAllPosts).
  posts(): Post[] {
    const out: Post[] = [];
    for (const tx of this.txs.values()) out.push(...extractPosts(tx, this.programId));
    return out.sort((a, b) => a.slot - b.slot || a.signature.localeCompare(b.signature));
  }
}
