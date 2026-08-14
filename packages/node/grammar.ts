import { Type } from "@sinclair/typebox";
import type { GrammarDefinition } from "@effectstream/concise";
import { builtinGrammars } from "@effectstream/sm/grammar";

// solana-post ← SolanaProgramLog; midnight-badges ← MidnightGeneric (decoded via config's ledgerSchema).
export const grammar = {
  "solana-post": [
    ["slot", Type.Number()],
    ["programId", Type.String()],
    ["logMessages", Type.Array(Type.String())],
  ],
  "midnight-badges": builtinGrammars.midnightGeneric,
} as const satisfies GrammarDefinition;
