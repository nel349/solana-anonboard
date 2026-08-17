// Prove the Midnight `join` circuit in the browser.
//
// The 32-byte member secret is used only to build the proof: it goes to the proof
// server (localhost) as a private witness, but never to the operator, and it is
// never a circuit argument nor part of the submitted transaction.
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import { createUnprovenCallTx } from "@midnight-ntwrk/midnight-js-contracts";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { toHex } from "@midnight-ntwrk/midnight-js-utils";
import {
  Anonboard,
  createAnonboardPrivateState,
  witnesses,
  deriveMemberPublicKey,
} from "../../../contracts-midnight/contract-anonboard/src/_index.ts";
// Re-exported so callers (App.tsx) keep importing it from here; the derivation
// itself is single-sourced in the contract package (member-key.ts).
export { deriveMemberPublicKey };
import {
  buildBrowserProviders,
  FetchZKConfigProvider,
  InMemoryPrivateStateProvider,
} from "./providers.ts";
import type { ConnectedWallet } from "./wallet.ts";

const NETWORK = {
  id: "undeployed",
  indexer: "http://127.0.0.1:8088/api/v3/graphql",
  indexerWS: "ws://127.0.0.1:8088/api/v3/graphql/ws",
  proofServer: "http://127.0.0.1:6300",
};
const PRIVATE_STATE_ID = "anonboardMemberState";

export function toHexString(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Throws if the member isn't on the roster (circuit asserts it) or the nullifier is spent (one join per member).
export async function proveJoin(
  badgePublicKey: Uint8Array,
  secret: Uint8Array,
  contractAddress: string,
): Promise<string> {
  setNetworkId(NETWORK.id);
  const walletSeed = crypto.getRandomValues(new Uint8Array(32));
  const providers = buildBrowserProviders({
    indexerUrl: NETWORK.indexer,
    indexerWsUrl: NETWORK.indexerWS,
    proofServerUrl: NETWORK.proofServer,
    zkAssetsBaseUrl: "/anonboard",
    walletSeed,
  });

  const compiled = CompiledContract.make(
    "contract-anonboard",
    Anonboard.Contract as never,
  ).pipe(
    CompiledContract.withWitnesses(witnesses as never),
    CompiledContract.withCompiledFileAssets("."), // inert: assets flow via zkConfigProvider
  );

  providers.privateStateProvider.setContractAddress(contractAddress);
  await providers.privateStateProvider.set(
    PRIVATE_STATE_ID,
    createAnonboardPrivateState(secret) as never,
  );

  const unproven = await createUnprovenCallTx(providers as never, {
    compiledContract: compiled as never,
    circuitId: "join" as never,
    contractAddress,
    args: [badgePublicKey] as never,
    privateStateId: PRIVATE_STATE_ID,
  } as never);

  const unbound = await providers.proofProvider.proveTx(
    (unproven as never as { private: { unprovenTx: unknown } }).private.unprovenTx as never,
  );
  return toHex((unbound as { serialize(): Uint8Array }).serialize());
}

// Wallet proves+pays+submits; the secret stays app-side (in-memory private state), only the witness-free tx goes to the wallet.
export async function joinViaWallet(
  wallet: ConnectedWallet,
  badgePublicKey: Uint8Array,
  secret: Uint8Array,
  contractAddress: string,
): Promise<void> {
  setNetworkId(NETWORK.id);

  // Requires the wallet to hold usable dust — stale dust historically surfaced as
  // InvalidDustSpendProof(170) at the node. The headless operator-blind path is
  // scripts/blind-join.ts.
  const addrs = await wallet.getShieldedAddresses();
  const zkConfig = new FetchZKConfigProvider("/anonboard");
  const privateStateProvider = new InMemoryPrivateStateProvider();

  const providers = {
    zkConfigProvider: zkConfig,
    publicDataProvider: indexerPublicDataProvider(NETWORK.indexer, NETWORK.indexerWS),
    privateStateProvider,
    walletProvider: {
      getCoinPublicKey: () => addrs.shieldedCoinPublicKey,
      getEncryptionPublicKey: () => addrs.shieldedEncryptionPublicKey,
    },
  };

  privateStateProvider.setContractAddress(contractAddress);
  await privateStateProvider.set(
    PRIVATE_STATE_ID,
    createAnonboardPrivateState(secret) as never,
  );

  const unproven = await createUnprovenCallTx(providers as never, {
    compiledContract: buildCompiledContract() as never,
    circuitId: "join" as never,
    contractAddress,
    args: [badgePublicKey] as never,
    privateStateId: PRIVATE_STATE_ID,
  } as never);

  // The witness (member secret) is resolved locally in the unproven build, so
  // proving needs only the proof server — do it in the browser (the secret never
  // leaves it). This is the same browser-side proving as proveJoin, and it works
  // with any wallet: the wallet is used only to pay (balance) and submit, not to
  // prove. (Delegating proving to the wallet needlessly required a proving-capable
  // connector — e.g. it fails over a WebSocket dev wallet.)
  const proofProvider = httpClientProofProvider(NETWORK.proofServer, zkConfig);
  const unbound = await proofProvider.proveTx(
    (unproven as never as { private: { unprovenTx: unknown } }).private.unprovenTx as never,
  );

  // join has a fallible section (Map insert), so it must be balanced UNSEALED.
  const unboundHex = toHex((unbound as { serialize(): Uint8Array }).serialize());
  const balanced = await wallet.balanceUnsealedTransaction(unboundHex);
  await wallet.submitTransaction(balanced.tx);
}

function buildCompiledContract() {
  return CompiledContract.make(
    "contract-anonboard",
    Anonboard.Contract as never,
  ).pipe(
    CompiledContract.withWitnesses(witnesses as never),
    CompiledContract.withCompiledFileAssets("."),
  );
}
