import type { GrammarDefinition } from "@effectstream/concise";
import { builtinGrammars } from "@effectstream/sm/grammar";

// midnight-badges ← MidnightGeneric (decoded via config's ledgerSchema).
export const grammar = {
  "midnight-badges": builtinGrammars.midnightGeneric,
} as const satisfies GrammarDefinition;
