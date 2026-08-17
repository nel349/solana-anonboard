// keypair/anonboard-program.json pubkey — deterministic local ID; replace with
// the deployed address for mainnet.
export const POST_PROGRAM_ID =
  "8veT8XVnBxG6kmq27CrCgznCtVHLJsBAqGHZrodKaRJ6" as const;

/** First instruction-data byte selecting the Post instruction. Arbitrary but
 *  fixed; must match `DISCRIMINANT_POST` in the Rust program (lib.rs). */
export const DISCRIMINANT_POST = 2;
