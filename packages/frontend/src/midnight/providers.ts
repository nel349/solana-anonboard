// The SDK ships only Node providers; the two that touch fs/LevelDB are reimplemented here for the browser.
import {
  ZKConfigProvider,
  createProverKey,
  createVerifierKey,
  createZKIR,
  type ProverKey,
  type VerifierKey,
  type ZKIR,
  type PrivateStateProvider,
} from "@midnight-ntwrk/midnight-js-types";

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
  async getSigningKey(address: string): Promise<string | null> {
    return this.signingKeys.has(address) ? (this.signingKeys.get(address) as string) : null;
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
