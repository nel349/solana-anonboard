import { Type } from "@sinclair/typebox";
import type { GrammarDefinition } from "@effectstream/concise";
import { builtinGrammars } from "@effectstream/sm/grammar";

// Two entries, one per chain.
//
// `solana-post`     fed by SolanaProgramLog: one event per tx touching the
//                   board program, carrying { slot, programId, logMessages }.
// `midnight-badges` fed by MidnightGeneric: the contract's exported ledger
//                   fields, decoded via the `ledgerSchema` in config.dev.ts.
export const grammar = {
  "solana-post": [
    ["slot", Type.Number()],
    ["programId", Type.String()],
    ["logMessages", Type.Array(Type.String())],
  ],
  "midnight-badges": builtinGrammars.midnightGeneric,
} as const satisfies GrammarDefinition;
