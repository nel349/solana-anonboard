// Secret key stays local — never a circuit argument, never in the transaction.
import type { WitnessContext, MerkleTreePath } from "@midnight-ntwrk/compact-runtime";
import type { Ledger } from "./managed/contract/index.js";

export type AnonboardPrivateState = {
  secretKey: Uint8Array;
};

export const createAnonboardPrivateState = (
  secretKey: Uint8Array,
): AnonboardPrivateState => ({ secretKey });

export const witnesses = {
  ["private$secret_key"]: (
    context: WitnessContext<Ledger, AnonboardPrivateState>,
  ): [AnonboardPrivateState, Uint8Array] => [
    context.privateState,
    context.privateState.secretKey,
  ],

  // The caller's Merkle path in the current roster, read from public ledger state.
  // The path (and its leaf = the member's key) stays private; the join circuit
  // discloses only the root it hashes to. Throws for a non-member (no leaf), which
  // surfaces as a failed join.
  ["roster_path"]: (
    context: WitnessContext<Ledger, AnonboardPrivateState>,
    pk: Uint8Array,
  ): [AnonboardPrivateState, MerkleTreePath<Uint8Array>] => {
    const path = context.ledger.roster.findPathForLeaf(pk);
    if (!path) {
      throw new Error("not on the roster (no Merkle path for this key)");
    }
    return [context.privateState, path];
  },
};
