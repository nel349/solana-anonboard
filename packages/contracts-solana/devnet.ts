// Shared devnet deployment. The post program is deployed immutably (`--final`) at this
// address; anyone who runs anonboard against devnet reuses it — no redeploy, so no
// program keypair or solana CLI needed on a clone. Recorded once by the first deployer.
export const SOLANA_DEVNET_PROGRAM_ID = "ELEQwpLmPFPzkkgK7K6K5RHdFM5uBsvpFekWGAuufd7j";

// The slot the program was deployed at — the sync node starts scanning devnet for posts
// here (posts land after deploy), instead of from genesis.
export const SOLANA_DEVNET_DEPLOY_SLOT = 485988703;
