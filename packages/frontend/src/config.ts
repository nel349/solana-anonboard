// Single source of the frontend's endpoints + constants. Endpoints come from the
// shared dev-config; nothing here is hardcoded ad-hoc across components.
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  DEV_BATCHER_FEE_PAYER,
  DEV_BATCHER_URL,
  DEV_NODE_API_URL,
  DEV_OPERATOR_URL,
  DEV_RPC_URL,
  POST_PROGRAM_ID as DEFAULT_POST_PROGRAM_ID,
} from "@solana-anonboard/contracts-solana";

// Solana RPC. Defaults to the local validator; set VITE_SOLANA_RPC_URL (via
// SOLANA_NETWORK=devnet on `bun run dev`) to point at a hosted cluster.
export const RPC =
  (import.meta.env.VITE_SOLANA_RPC_URL as string | undefined) || DEV_RPC_URL;
export const BATCHER_URL = DEV_BATCHER_URL;
export const OPERATOR_URL = DEV_OPERATOR_URL;
export const POSTS_URL = `${DEV_NODE_API_URL}/api/posts`;
export const BADGES_URL = `${DEV_NODE_API_URL}/api/badges`;

// Batcher fee-payer (sponsor) + post program. Default to the committed local dev values;
// VITE_BATCHER_FEE_PAYER / VITE_POST_PROGRAM_ID override them on devnet.
const BATCHER_FEE_PAYER =
  (import.meta.env.VITE_BATCHER_FEE_PAYER as string | undefined) || DEV_BATCHER_FEE_PAYER;
export const SPONSOR = new PublicKey(BATCHER_FEE_PAYER);
export const SPONSOR_ADDR = BATCHER_FEE_PAYER; // for display
export const POST_PROGRAM_ID =
  (import.meta.env.VITE_POST_PROGRAM_ID as string | undefined) || DEFAULT_POST_PROGRAM_ID;

export const ADDRESS_TYPE_SOLANA = 9; // AddressType.SOLANA (see @effectstream/utils)
export const MAX_BODY = 280; // bounded by the Solana tx size

// Sponsor pays 5,000 lamports/signature × 2 sigs per post; author pays nothing.
const LAMPORTS_PER_SIGNATURE = 5000;
const SIGNATURES_PER_POST = 2; // badge author + sponsor fee-payer
export const COST_PER_POST_LAMPORTS = LAMPORTS_PER_SIGNATURE * SIGNATURES_PER_POST;
export const COST_PER_POST_SOL = COST_PER_POST_LAMPORTS / LAMPORTS_PER_SOL;

// Which Midnight network the UI talks to. Defaults to the local `undeployed` chain;
// set VITE_MIDNIGHT_NETWORK_ID=preview|preprod (via MIDNIGHT_NETWORK_ID on `bun run dev`)
// to point at a hosted net. Solana + the proof server stay local either way.
export const NETWORK_ID =
  (import.meta.env.VITE_MIDNIGHT_NETWORK_ID as string | undefined) || "undeployed";

// The deployed address is written per-network as contract-anonboard.<net>.json on every
// deploy. Glob-import them (eager, so HMR picks up a redeploy) and select this network's.
const contractAddresses = import.meta.glob<{ contractAddress: string }>(
  "../../contracts-midnight/contract-anonboard.*.json",
  { eager: true, import: "default" },
);
const contractEntry = Object.entries(contractAddresses).find(([path]) =>
  path.endsWith(`.${NETWORK_ID}.json`),
);
export const CONTRACT_ADDRESS = contractEntry?.[1].contractAddress ?? "";

// Anonymous session identity, unlinkable to the on-chain member. Not the user's wallet.
export const BADGE_STORAGE_KEY = "anonboard.badge.v1";
