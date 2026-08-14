// Prove the Midnight `join` circuit in the browser and derive a member's public
// key from a membership secret.
//
// The 32-byte secret never leaves the browser; the returned unbound tx carries no secret, so the operator can pay+submit blind.
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import { createUnprovenCallTx } from "@midnight-ntwrk/midnight-js-contracts";
import { createProofProvider } from "@midnight-ntwrk/midnight-js-types";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { toHex } from "@midnight-ntwrk/midnight-js-utils";
import { CostModel } from "@midnight-ntwrk/ledger-v8";
import {
  persistentHash,
  CompactTypeVector,
  CompactTypeBytes,
} from "@midnight-ntwrk/compact-runtime";
import {
  Anonboard,
  createAnonboardPrivateState,
  witnesses,
} from "../../../contracts-midnight/contract-anonboard/src/_index.ts";
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

function pad32(s: string): Uint8Array {
  const b = new Uint8Array(32);
  b.set(new TextEncoder().encode(s));
  return b;
}

// public_key(sk) = persistentHash<Vector<2,Bytes<32>>>([pad(32,"anonboard:pk:"), sk]).
// Must match the circuit (anonboard.compact) and scripts/blind-join.ts exactly,
// so the derived key equals what add_to_roster stores.
export function deriveMemberPublicKey(secret: Uint8Array): Uint8Array {
  const t = new CompactTypeVector(2, new CompactTypeBytes(32));
  return persistentHash(t as never, [pad32("anonboard:pk:"), secret] as never);
}

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

  // Wallet-pays path fails at the node with InvalidDustSpendProof(170) on stale dust — app uses the operator-blind path instead.
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

  // Witness was resolved locally in the unproven build; the proof server never sees the secret.
  const provingProvider = await wallet.getProvingProvider(
    (zkConfig as unknown as { asKeyMaterialProvider(): unknown }).asKeyMaterialProvider(),
  );
  const proofProvider = createProofProvider(
    provingProvider as never,
    CostModel.initialCostModel() as never,
  );
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
