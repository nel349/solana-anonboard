// Single source of the frontend's endpoints + constants. Endpoints come from the
// shared dev-config; nothing here is hardcoded ad-hoc across components.
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  DEV_BATCHER_FEE_PAYER,
  DEV_BATCHER_URL,
  DEV_NODE_API_URL,
  DEV_OPERATOR_URL,
  DEV_RPC_URL,
} from "@solana-anonboard/contracts-solana";
// Rewritten on every deploy; importing the JSON lets HMR pick up the new address.
import contractInfo from "../../contracts-midnight/contract-anonboard.undeployed.json";

export const RPC = DEV_RPC_URL;
export const BATCHER_URL = DEV_BATCHER_URL;
export const OPERATOR_URL = DEV_OPERATOR_URL;
export const POSTS_URL = `${DEV_NODE_API_URL}/api/posts`;
export const BADGES_URL = `${DEV_NODE_API_URL}/api/badges`;

export const SPONSOR = new PublicKey(DEV_BATCHER_FEE_PAYER);
export const SPONSOR_ADDR = DEV_BATCHER_FEE_PAYER; // for display

export const ADDRESS_TYPE_SOLANA = 9; // AddressType.SOLANA (see @effectstream/utils)
export const MAX_BODY = 280; // bounded by the Solana tx size

// Sponsor pays 5,000 lamports/signature × 2 sigs per post; author pays nothing.
const LAMPORTS_PER_SIGNATURE = 5000;
const SIGNATURES_PER_POST = 2; // badge author + sponsor fee-payer
export const COST_PER_POST_LAMPORTS = LAMPORTS_PER_SIGNATURE * SIGNATURES_PER_POST;
export const COST_PER_POST_SOL = COST_PER_POST_LAMPORTS / LAMPORTS_PER_SOL;

export const CONTRACT_ADDRESS = contractInfo.contractAddress;
export const NETWORK_ID = "undeployed";

// Anonymous session identity, unlinkable to the on-chain member. Not the user's wallet.
export const BADGE_STORAGE_KEY = "anonboard.badge.v1";
