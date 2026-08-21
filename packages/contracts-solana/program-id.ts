// keypair/anonboard-program.json pubkey — deterministic local ID; replace with the deployed
// address on a hosted net (devnet id lives in devnet.ts).
export const POST_PROGRAM_ID =
  "8veT8XVnBxG6kmq27CrCgznCtVHLJsBAqGHZrodKaRJ6" as const;

// Instruction-data discriminants (first byte). Must match lib.rs.
export const DISCRIMINANT_POST = 2;
export const DISCRIMINANT_CLOSE = 3;

// PDA seed prefixes (must match lib.rs).
export const POST_SEED = "post";
export const COUNTER_SEED = "author";

// Account tags (first data byte) — lets getProgramAccounts filter posts from counters.
export const TAG_POST = 1;
export const TAG_COUNTER = 2;

// Max post body — fixes the post account size (and thus rent). Must match lib.rs MAX_BODY.
export const MAX_BODY = 280;

// Post account byte layout (must match lib.rs):
// tag(1) author(32) payer(32) slot(8) index(8) body_len(2) body(MAX_BODY)
export const POST_LAYOUT = {
  author: 1,
  payer: 33,
  slot: 65,
  index: 73,
  bodyLen: 81,
  body: 83,
} as const;
