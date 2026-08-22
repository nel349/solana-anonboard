// Shared devnet deployment. The post program stores each post in a program-owned account
// (state) and is deployed immutably (`--final`) at this address; anyone who runs anonboard
// against devnet reuses it — no redeploy, so no program keypair or solana CLI on a clone.
export const SOLANA_DEVNET_PROGRAM_ID = "HUygLMgVXifohJK4nZjsgSMXcpUbJMxv1Rxi8AwoNqAE";

// The slot the program was deployed at (provenance). The account reader lists posts via
// getProgramAccounts (current state), so it needs no start slot — this is just a record.
export const SOLANA_DEVNET_DEPLOY_SLOT = 486459386;
