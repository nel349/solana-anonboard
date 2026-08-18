// Reads the current badge set straight from the contract's on-chain ledger state, in
// one query, so the sync can start near head instead of replaying from the deploy block.
// The badge map is contract state — reading it at head yields every member — but the
// live sync only observes it on contract-call blocks, so historical joins would be
// missed by a near-head start. Seeding closes that gap: existing members come from this
// read, new joins come from the live sync.
//
// The SDK's queryContractState returns null here, so we issue the raw contractAction
// query (verified working) and deserialize it the same way the SDK would.

import { readMidnightContract } from "@effectstream/midnight-contracts/read-contract";
import { midnightNetworkConfig } from "@effectstream/midnight-contracts/midnight-env";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { ContractState } from "@midnight-ntwrk/compact-runtime";
import { fromHex } from "@midnight-ntwrk/midnight-js-utils";
import { Anonboard } from "../contracts-midnight/contract-anonboard/src/_index.ts";
import bs58 from "bs58";

export type OnChainBadges = { height: number; badges: string[] };

/** Current chain head + the contract's badge set, or null if the indexer/state is unavailable. */
export async function fetchOnChainBadges(): Promise<OnChainBadges | null> {
  // Any failure — indexer unreachable, rate-limited (403 with an HTML body that fails
  // res.json()), timeout, or an unparseable state — must degrade to null so the caller
  // falls back to the deploy-block replay. It must never throw: this runs inside a
  // top-level await, so a throw would crash the sync process at import instead.
  try {
    const info = readMidnightContract("contract-anonboard", {
      networkId: midnightNetworkConfig.id,
    });
    if (!info.contractAddress) return null;
    setNetworkId(midnightNetworkConfig.id);

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    let json: {
      data?: { block?: { height?: number }; contractAction?: { state?: string } };
    };
    try {
      const res = await fetch(midnightNetworkConfig.indexer, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `{ block { height } contractAction(address: "${info.contractAddress}") { state } }`,
        }),
        signal: ctl.signal,
      });
      json = await res.json();
    } finally {
      clearTimeout(timer);
    }

    const stateHex = json?.data?.contractAction?.state;
    if (!stateHex) return null;
    const height = typeof json?.data?.block?.height === "number" ? json.data.block.height : 0;
    return { height, badges: parseBadgesFromState(stateHex) };
  } catch (e) {
    console.warn(
      `[sync] on-chain badge seed failed (${e instanceof Error ? e.message : String(e)}); ` +
        `falling back to deploy-block replay`,
    );
    return null;
  }
}

/** Extract the badge pubkeys (base58) from a serialized contract-state hex string. */
export function parseBadgesFromState(stateHex: string): string[] {
  const ledger = Anonboard.ledger(
    (ContractState.deserialize(fromHex(stateHex)) as { data: unknown }).data,
  );
  const badges: string[] = [];
  for (const [key] of ledger.badges) badges.push(bs58.encode(key as Uint8Array));
  return badges;
}

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

/** Mirror an on-chain badge set into the badges table (idempotent). */
export async function insertSeedBadges(pool: Queryable, seed: OnChainBadges): Promise<void> {
  for (const pubkey of seed.badges) {
    await pool.query(
      "INSERT INTO badges (pubkey, block_height) VALUES ($1, $2) ON CONFLICT (pubkey) DO NOTHING",
      [pubkey, seed.height],
    );
  }
}
