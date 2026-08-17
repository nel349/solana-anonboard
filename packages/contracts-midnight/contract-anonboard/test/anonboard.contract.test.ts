// Contract-level unit tests for the anonboard Compact circuit, run in-memory with
// the compact-runtime circuit simulator (no localnet, no proving). These exercise
// every circuit path AND assert the anonymity property the redesign exists for:
// a join must NOT disclose the member's identity key in its public transcript.
//
// Run: bun test  (from this package)
import { describe, it, expect } from "bun:test";
import {
  createConstructorContext,
  createCircuitContext,
  sampleContractAddress,
  persistentHash,
  CompactTypeVector,
  CompactTypeBytes,
  type CircuitContext,
} from "@midnight-ntwrk/compact-runtime";
import {
  Contract,
  ledger,
  type Ledger,
} from "../src/managed/contract/index.js";
import {
  witnesses,
  createAnonboardPrivateState,
  type AnonboardPrivateState,
} from "../src/witnesses.ts";

// ── Derivations that must match the circuit (public_key / nullifier tags). ──
function pad32(s: string): Uint8Array {
  const b = new Uint8Array(32);
  b.set(new TextEncoder().encode(s));
  return b;
}
const vec2 = new CompactTypeVector(2, new CompactTypeBytes(32));
function pubKey(sk: Uint8Array): Uint8Array {
  return persistentHash(vec2 as never, [pad32("anonboard:pk:"), sk] as never);
}
function nullifierOf(sk: Uint8Array): Uint8Array {
  return persistentHash(vec2 as never, [pad32("anonboard:nul:"), sk] as never);
}
function secret(n: number): Uint8Array {
  const b = new Uint8Array(32);
  b[0] = n;
  b[31] = 0xab;
  return b;
}
function badge(n: number): Uint8Array {
  // Dense, distinctive 32 bytes (no zero bytes) so the disclosed value appears as
  // one contiguous run in the transcript — like a real random Solana key. (A value
  // with trailing zeros can straddle transcript alignment chunks.)
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) b[i] = ((n * 7 + i * 13 + 0x21) & 0xff) || 0x21;
  return b;
}
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

// Collect every byte string anywhere in a value into one hex blob, so we can ask
// "does this disclosed transcript contain <these 32 bytes>?" without depending on
// the internal Op/AlignedValue shape.
function deepHex(obj: unknown, acc: string[] = []): string[] {
  if (obj == null) return acc;
  if (obj instanceof Uint8Array) {
    acc.push(Buffer.from(obj).toString("hex"));
  } else if (Array.isArray(obj)) {
    for (const x of obj) deepHex(x, acc);
  } else if (typeof obj === "object") {
    for (const k of Object.keys(obj)) deepHex((obj as Record<string, unknown>)[k], acc);
  }
  return acc;
}
const transcriptHex = (proofData: unknown) =>
  deepHex((proofData as { publicTranscript?: unknown }).publicTranscript ?? proofData).join("");

// ── Thin simulator over the raw compact-runtime API (zkloan-style). ──
const COIN_PK = "0".repeat(64);

class Sim {
  contract: Contract<AnonboardPrivateState>;
  ctx: CircuitContext<AnonboardPrivateState>;

  constructor(ownerSecret: Uint8Array, w = witnesses) {
    this.contract = new Contract<AnonboardPrivateState>(w as never);
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(
        createConstructorContext(createAnonboardPrivateState(ownerSecret), COIN_PK),
      );
    this.ctx = createCircuitContext(
      sampleContractAddress(),
      currentZswapLocalState,
      currentContractState,
      currentPrivateState,
    );
  }

  as(sk: Uint8Array): this {
    this.ctx = { ...this.ctx, currentPrivateState: createAnonboardPrivateState(sk) };
    return this;
  }
  addToRoster(memberPk: Uint8Array): void {
    this.ctx = this.contract.impureCircuits.add_to_roster(this.ctx, memberPk).context;
  }
  join(b: Uint8Array) {
    const r = this.contract.impureCircuits.join(this.ctx, b);
    this.ctx = r.context;
    return r;
  }
  ledger(): Ledger {
    return ledger(this.ctx.currentQueryContext.state);
  }
}

const OWNER = secret(1);

describe("anonboard contract", () => {
  it("constructor sets the owner to public_key(owner secret)", () => {
    const sim = new Sim(OWNER);
    expect(hex(sim.ledger().owner)).toBe(hex(pubKey(OWNER)));
  });

  describe("add_to_roster", () => {
    it("owner can add a member; the member gets a Merkle path", () => {
      const sim = new Sim(OWNER);
      const memberPk = pubKey(secret(2));
      sim.as(OWNER);
      sim.addToRoster(memberPk);
      expect(sim.ledger().roster.findPathForLeaf(memberPk)).toBeDefined();
      expect(sim.ledger().roster.firstFree()).toBe(1n);
    });

    it("a non-owner cannot add to the roster", () => {
      const sim = new Sim(OWNER);
      sim.as(secret(99)); // not the owner
      expect(() => sim.addToRoster(pubKey(secret(2)))).toThrow(/only owner/);
    });
  });

  describe("join", () => {
    it("a rostered member joins: badge recorded, count incremented", () => {
      const sim = new Sim(OWNER);
      const member = secret(2);
      sim.as(OWNER).addToRoster(pubKey(member));
      const b = badge(7);
      sim.as(member).join(b);
      expect(sim.ledger().badges.member(b)).toBe(true);
      expect(sim.ledger().badge_count).toBe(1n);
    });

    it("a non-member cannot join (no roster path)", () => {
      const sim = new Sim(OWNER);
      sim.as(OWNER).addToRoster(pubKey(secret(2)));
      // secret(3) is not on the roster
      expect(() => sim.as(secret(3)).join(badge(7))).toThrow(/not on the roster/);
    });

    it("the one-shot nullifier blocks a second join with the same secret", () => {
      const sim = new Sim(OWNER);
      const member = secret(2);
      sim.as(OWNER).addToRoster(pubKey(member));
      sim.as(member).join(badge(7));
      expect(() => sim.as(member).join(badge(8))).toThrow(/already joined/);
    });

    it("two distinct members can each join and get distinct badges", () => {
      const sim = new Sim(OWNER);
      const a = secret(2);
      const c = secret(3);
      sim.as(OWNER).addToRoster(pubKey(a));
      sim.as(OWNER).addToRoster(pubKey(c));
      sim.as(a).join(badge(7));
      sim.as(c).join(badge(8));
      expect(sim.ledger().badges.member(badge(7))).toBe(true);
      expect(sim.ledger().badges.member(badge(8))).toBe(true);
      expect(sim.ledger().badge_count).toBe(2n);
    });

    // The critical bypass guard: a valid roster path is PUBLIC (anyone can compute
    // one for any member), so the circuit must bind the path's leaf to the caller's
    // own key. Inject a witness that returns member A's path for a different caller;
    // the join must reject it.
    it("rejects a borrowed path that isn't for the caller's key (pk == leaf guard)", () => {
      const owner = new Sim(OWNER);
      const memberA = secret(2);
      owner.as(OWNER).addToRoster(pubKey(memberA));
      const pathA = owner.ledger().roster.findPathForLeaf(pubKey(memberA));
      expect(pathA).toBeDefined();

      // Malicious witness: hand out member A's path no matter who asks.
      const evilWitnesses = {
        ...witnesses,
        ["roster_path"]: (context: { privateState: AnonboardPrivateState }) => [
          context.privateState,
          pathA,
        ],
      };
      const attacker = secret(4); // knows a secret, but is NOT on the roster
      // Reuse the owner's ledger state (roster with A) under the evil-witness contract.
      const evil = new Contract<AnonboardPrivateState>(evilWitnesses as never);
      const evilCtx = createCircuitContext(
        sampleContractAddress(),
        owner.ctx.currentZswapLocalState,
        owner.ctx.currentQueryContext.state,
        createAnonboardPrivateState(attacker),
      );
      expect(() => evil.impureCircuits.join(evilCtx, badge(9))).toThrow(
        /path is not for your key/,
      );
    });
  });

  describe("anonymity (the whole point)", () => {
    it("a join does NOT disclose the member's identity key, only the nullifier and badge", () => {
      const sim = new Sim(OWNER);
      const member = secret(2);
      sim.as(OWNER).addToRoster(pubKey(member));
      const b = badge(7);
      const r = sim.as(member).join(b);

      const disclosed = transcriptHex(r.proofData);

      // Sanity: the values a join is SUPPOSED to make public are present, proving
      // the transcript introspection actually sees disclosed values.
      expect(disclosed).toContain(hex(nullifierOf(member)));
      expect(disclosed).toContain(hex(b));

      // The regression guard for the critical fix: the member's stable identity key
      // (its roster leaf) must NEVER appear in the public transcript.
      expect(disclosed).not.toContain(hex(pubKey(member)));
    });
  });
});
