// Unit tests for the devnet post reader core. These assert real values — that the index
// recovers the exact post, that a CPI cannot spoof a post under our program's name (the
// authorization boundary), that reverted txs are dropped, and that the sweep is idempotent.
// A bug here looks identical to "posts never appear on devnet". Run: bun test (this package).
import { describe, it, expect } from "bun:test";
import bs58 from "bs58";
import { DevnetPostIndex, extractPosts, type ReaderRpc } from "../solana-post-reader-lib.ts";

const PROGRAM = "ELEQwpLmPFPzkkgK7K6K5RHdFM5uBsvpFekWGAuufd7j";
const OTHER = "EVIL1111111111111111111111111111111111111111";
const AUTHOR = bs58.encode(Uint8Array.from({ length: 32 }, (_, i) => (i + 1) & 0xff));
const START = 1000;

function ourLogs(author: string, slot: number, body: string): string[] {
  return [
    `Program ${PROGRAM} invoke [1]`,
    `Program log: ANONBOARD_POST|${author}|${slot}|${body}`,
    `Program ${PROGRAM} consumed 12104 of 200000 compute units`,
    `Program ${PROGRAM} success`,
  ];
}

function stubRpc(): ReaderRpc & { txCalls: number } {
  const sigs = [
    { signature: "sigReverted", slot: 1006, err: { InstructionError: [0, "X"] } },
    { signature: "sigPost", slot: 1005, err: null },
  ]; // newest-first
  const state = {
    txCalls: 0,
    getSlot: async () => 1010,
    getSignaturesForAddress: async (_p: string, opts: { before?: string; limit: number }) =>
      opts.before ? [] : sigs, // single page
    getTransaction: async (signature: string) => {
      state.txCalls++;
      if (signature === "sigPost") return { meta: { logMessages: ourLogs(AUTHOR, 1005, "hello devnet") } };
      return { meta: { logMessages: [] } };
    },
  };
  return state;
}

describe("extractPosts (authorization boundary)", () => {
  it("recovers the exact post our program emitted", () => {
    const posts = extractPosts({ signature: "s", slot: 5, logMessages: ourLogs(AUTHOR, 5, "hi|with|pipes") }, PROGRAM);
    expect(posts).toEqual([{ author: AUTHOR, body: "hi|with|pipes", slot: 5, signature: "s" }]);
  });

  it("does NOT attribute a post a CPI to another program logged under our name", () => {
    const logs = [
      `Program ${PROGRAM} invoke [1]`,
      `Program log: ANONBOARD_POST|${AUTHOR}|5|real`,
      `Program ${OTHER} invoke [2]`,
      `Program log: ANONBOARD_POST|victimPubkey|5|spoofed`, // emitted by OTHER, not us
      `Program ${OTHER} success`,
      `Program ${PROGRAM} success`,
    ];
    const posts = extractPosts({ signature: "s", slot: 5, logMessages: logs }, PROGRAM);
    expect(posts.map((p) => p.body)).toEqual(["real"]); // the spoof is excluded
  });

  it("returns nothing for a tx that never invoked our program", () => {
    const logs = [`Program ${OTHER} invoke [1]`, `Program log: ANONBOARD_POST|x|5|y`, `Program ${OTHER} success`];
    expect(extractPosts({ signature: "s", slot: 5, logMessages: logs }, PROGRAM)).toEqual([]);
  });
});

describe("DevnetPostIndex", () => {
  it("indexes devnet signatures and yields the parsed post", async () => {
    const rpc = stubRpc();
    const idx = new DevnetPostIndex(rpc, PROGRAM, START);
    await idx.refresh();
    expect(idx.posts()).toEqual([{ author: AUTHOR, body: "hello devnet", slot: 1005, signature: "sigPost" }]);
  });

  it("drops a reverted tx", async () => {
    const rpc = stubRpc();
    const idx = new DevnetPostIndex(rpc, PROGRAM, START);
    await idx.refresh();
    expect(idx.posts().some((p) => p.signature === "sigReverted")).toBe(false);
  });

  it("is idempotent: a second refresh re-fetches no known transaction", async () => {
    const rpc = stubRpc();
    const idx = new DevnetPostIndex(rpc, PROGRAM, START);
    await idx.refresh();
    const after = rpc.txCalls;
    await idx.refresh();
    expect(rpc.txCalls).toBe(after);
  });

  it("orders posts oldest-slot-first so newest gets the highest DB id", async () => {
    const many: ReaderRpc = {
      getSlot: async () => 2000,
      getSignaturesForAddress: async (_p, opts) =>
        opts.before ? [] : [
          { signature: "b", slot: 1200, err: null },
          { signature: "a", slot: 1100, err: null },
        ],
      getTransaction: async (sig) => ({
        meta: { logMessages: ourLogs(AUTHOR, sig === "b" ? 1200 : 1100, sig) },
      }),
    };
    const idx = new DevnetPostIndex(many, PROGRAM, START);
    await idx.refresh();
    expect(idx.posts().map((p) => p.slot)).toEqual([1100, 1200]);
  });
});
