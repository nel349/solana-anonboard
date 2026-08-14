// keypair/counter-program.json pubkey — deterministic local ID; replace with
// the deployed address for mainnet.
import { Buffer } from "buffer";

export const COUNTER_PROGRAM_ID =
  "8veT8XVnBxG6kmq27CrCgznCtVHLJsBAqGHZrodKaRJ6" as const;

/** Discriminant bytes — must match the Rust program. */
export const DISCRIMINANT_INCREMENT = 0;
export const DISCRIMINANT_RESET = 1;
export const DISCRIMINANT_POST = 2;

export const COUNTER_SEED = Buffer.from("counter");
