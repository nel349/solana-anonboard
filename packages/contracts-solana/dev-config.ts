/**
 * Local dev constants shared by frontend, batcher, and tests.
 *
 * `DEV_BATCHER_FEE_PAYER` is a last-resort fallback only. The real sponsor pubkey comes
 * from the generated (gitignored) keypair via `VITE_BATCHER_FEE_PAYER` / the keypair file;
 * this constant is the old committed key, kept so callers have a value when no env is set.
 */
export const DEV_RPC_URL = "http://localhost:8899";
export const DEV_BATCHER_URL = "http://localhost:3334";
export const DEV_NODE_API_URL = "http://localhost:9999";
// Operator (packages/operator): Midnight owner/fee-payer that runs add_to_roster
// and submits join txs.
export const DEV_OPERATOR_URL = "http://localhost:3335";
export const DEV_NAMESPACE = "solana-anonboard";
export const DEV_BATCHER_FEE_PAYER =
  "3oFfnPdVbZZRapZTLgZ1ZDCmdf4YjGMpzDgukoWYpXqW";
export const DEV_BATCHER_TARGET = "solana";
