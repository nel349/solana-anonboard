// The SDK ships only Node providers; the two that touch fs/LevelDB are reimplemented here for the browser.
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

// zk-config over HTTP from public/: <baseUrl>/keys/<c>.prover|.verifier, <baseUrl>/zkir/<c>.bzkir
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

// Session-only Map. get/set/setContractAddress are used; the export/import + signing-key surface throws so accidental reliance is loud.
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

// Browser never pays: operator balances + submits, so balanceTx/submitTx throw here. Keys are a throwaway zswap pair, not the payer's.
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
