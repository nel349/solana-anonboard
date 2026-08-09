// Browser-side Midnight providers for proving the `join` circuit client-side.
//
// The SDK ships only Node providers (fs zk-config, LevelDB private state), so
// the two that touch fs/Level are re-implemented here for the browser. The
// other two (indexer public data, http-client proof) are already
// browser-portable and reused as-is. See docs: only createUnprovenCallTx +
// proveTx are on this path, and between them they dereference exactly:
//   publicDataProvider, privateStateProvider.get, zkConfigProvider,
//   walletProvider.getCoinPublicKey/getEncryptionPublicKey, proofProvider.
import {
  ZKConfigProvider,
  createProverKey,
  createVerifierKey,
  createZKIR,
  type ProverKey,
  type VerifierKey,
  type ZKIR,
  type MidnightProviders,
  type WalletProvider,
  type MidnightProvider,
  type PrivateStateProvider,
} from "@midnight-ntwrk/midnight-js-types";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { ZswapSecretKeys } from "@midnight-ntwrk/ledger-v8";

// ── zk-config over fetch() ──────────────────────────────────────────────────
// Mirrors NodeZkConfigProvider but reads the artifacts over HTTP from public/
// instead of the filesystem. Layout served by Vite:
//   <baseUrl>/keys/<circuit>.prover  .verifier   and   <baseUrl>/zkir/<circuit>.bzkir
export class FetchZKConfigProvider<K extends string> extends ZKConfigProvider<K> {
  constructor(private readonly baseUrl: string) {
    super();
  }

  private async fetchBytes(sub: string, id: K, ext: string): Promise<Uint8Array> {
    const url = `${this.baseUrl}/${sub}/${id}${ext}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`zk asset ${url}: ${res.status} ${res.statusText}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async getProverKey(circuitId: K): Promise<ProverKey> {
    return createProverKey(await this.fetchBytes("keys", circuitId, ".prover"));
  }
  async getVerifierKey(circuitId: K): Promise<VerifierKey> {
    return createVerifierKey(await this.fetchBytes("keys", circuitId, ".verifier"));
  }
  async getZKIR(circuitId: K): Promise<ZKIR> {
    return createZKIR(await this.fetchBytes("zkir", circuitId, ".bzkir"));
  }
}

// ── private state in memory ─────────────────────────────────────────────────
// The `join` circuit's witness reads the 32-byte membership secret from private
// state at proving time. In the browser it lives only for the session, in a
// Map. Only get/set/setContractAddress are exercised by createUnprovenCallTx;
// the export/import + signing-key surface throws so any accidental reliance is
// loud rather than silent.
export class InMemoryPrivateStateProvider implements PrivateStateProvider {
  private readonly states = new Map<string, unknown>();
  private readonly signingKeys = new Map<string, unknown>();

  setContractAddress(_address: string): void {
    // No per-address scoping needed for a single-contract browser session.
  }
  async set(id: string, state: unknown): Promise<void> {
    this.states.set(id, state);
  }
  async get(id: string): Promise<unknown> {
    return this.states.has(id) ? this.states.get(id) : null;
  }
  async remove(id: string): Promise<void> {
    this.states.delete(id);
  }
  async clear(): Promise<void> {
    this.states.clear();
  }
  async setSigningKey(address: string, key: unknown): Promise<void> {
    this.signingKeys.set(address, key);
  }
  async getSigningKey(address: string): Promise<unknown> {
    return this.signingKeys.has(address) ? this.signingKeys.get(address) : null;
  }
  async removeSigningKey(address: string): Promise<void> {
    this.signingKeys.delete(address);
  }
  async clearSigningKeys(): Promise<void> {
    this.signingKeys.clear();
  }
  async exportPrivateStates(): Promise<never> {
    throw new Error("exportPrivateStates: not supported in the browser session store");
  }
  async importPrivateStates(): Promise<never> {
    throw new Error("importPrivateStates: not supported in the browser session store");
  }
  async exportSigningKeys(): Promise<never> {
    throw new Error("exportSigningKeys: not supported in the browser session store");
  }
  async importSigningKeys(): Promise<never> {
    throw new Error("importSigningKeys: not supported in the browser session store");
  }
}

// ── wallet adapter ──────────────────────────────────────────────────────────
// createUnprovenCallTx needs a coin + encryption public key to shape the call
// tx. Party A (the browser) never pays: the operator balances + submits, so
// balanceTx/submitTx must never be called here and throw if they are. The keys
// come from a fresh, throwaway zswap keypair — independent of the payer's, as
// in scripts/blind-join.ts.
export function makeBrowserWalletProvider(seed: Uint8Array): WalletProvider & MidnightProvider {
  const zswap = ZswapSecretKeys.fromSeed(seed);
  return {
    getCoinPublicKey: () => zswap.coinPublicKey,
    getEncryptionPublicKey: () => zswap.encryptionPublicKey,
    balanceTx: () => {
      throw new Error(
        "balanceTx called in the browser: the operator balances + submits, not the client",
      );
    },
    submitTx: () => {
      throw new Error(
        "submitTx called in the browser: the operator balances + submits, not the client",
      );
    },
  };
}

export type BrowserProviderConfig = {
  indexerUrl: string;
  indexerWsUrl: string;
  proofServerUrl: string;
  zkAssetsBaseUrl: string; // e.g. "/anonboard"
  walletSeed: Uint8Array; // throwaway zswap seed for tx shaping only
};

// Assemble the minimal provider set for createUnprovenCallTx('join') + proveTx.
export function buildBrowserProviders(cfg: BrowserProviderConfig): MidnightProviders {
  const zkConfigProvider = new FetchZKConfigProvider(cfg.zkAssetsBaseUrl);
  const walletProvider = makeBrowserWalletProvider(cfg.walletSeed);
  return {
    zkConfigProvider,
    publicDataProvider: indexerPublicDataProvider(cfg.indexerUrl, cfg.indexerWsUrl),
    proofProvider: httpClientProofProvider(cfg.proofServerUrl, zkConfigProvider),
    privateStateProvider: new InMemoryPrivateStateProvider(),
    walletProvider,
    midnightProvider: walletProvider,
  } as MidnightProviders;
}
