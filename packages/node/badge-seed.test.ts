import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { parseBadgesFromState } from "./badge-seed.ts";

// A real preview contract-state snapshot with two known badges, so the ledger
// deserialize → badge extraction path (which broke once via the SDK's queryContractState)
// stays locked to a concrete expectation across SDK/ledger upgrades.
const fixture = JSON.parse(
  readFileSync(path.join(import.meta.dirname!, "__fixtures__/contract-state-2-badges.json"), "utf8"),
) as { network: string; expectedBadges: string[]; stateHex: string };

describe("parseBadgesFromState", () => {
  test("extracts every badge pubkey from real contract state", () => {
    setNetworkId(fixture.network);
    const badges = parseBadgesFromState(fixture.stateHex);
    expect([...badges].sort()).toEqual([...fixture.expectedBadges].sort());
  });

  test("badges are base58, not hex or raw bytes", () => {
    setNetworkId(fixture.network);
    for (const b of parseBadgesFromState(fixture.stateHex)) {
      expect(b).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/); // base58 alphabet
      expect(b).not.toMatch(/^0x/);
    }
  });
});
