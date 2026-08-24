// Wallets inject window.midnight[<key>]: { rdns, name, icon, apiVersion, connect(networkId) }.
import { createWalletClient } from "midnight-wallet-connector";

export type DetectedWallet = {
  key: string; // the window.midnight key
  name: string;
  icon: string;
  rdns: string;
  apiVersion: string;
};

// Local subset of the connected API so we don't build-depend on the connector's type package.
export type ConnectedWallet = {
  getShieldedAddresses(): Promise<{
    shieldedAddress: string;
    shieldedCoinPublicKey: string;
    shieldedEncryptionPublicKey: string;
  }>;
  getUnshieldedAddress(): Promise<{ unshieldedAddress: string }>;
  getConfiguration(): Promise<{
    indexerUri: string;
    indexerWsUri: string;
    proverServerUri?: string;
    substrateNodeUri: string;
    networkId: string;
  }>;
  getConnectionStatus(): Promise<
    { status: "connected"; networkId: string } | { status: "disconnected" }
  >;
  getProvingProvider(keyMaterialProvider: unknown): Promise<unknown>;
  balanceUnsealedTransaction(
    tx: string,
    options?: { payFees?: boolean },
  ): Promise<{ tx: string }>;
  submitTransaction(tx: string): Promise<void>;
  hintUsage?(methodNames: string[]): Promise<void>;
};

type InitialAPI = {
  rdns?: string;
  name?: string;
  icon?: string;
  apiVersion?: string;
  connect(networkId: string): Promise<ConnectedWallet>;
};

function isConnectorWallet(w: unknown): w is InitialAPI {
  return (
    !!w &&
    typeof w === "object" &&
    "apiVersion" in w &&
    typeof (w as InitialAPI).connect === "function"
  );
}

// v4 connector wallets only; other majors have a different method surface.
export function detectMidnightWallets(): DetectedWallet[] {
  const injected = (window as unknown as { midnight?: Record<string, unknown> }).midnight ?? {};
  const out: DetectedWallet[] = [];
  for (const [key, w] of Object.entries(injected)) {
    if (!isConnectorWallet(w)) continue;
    const apiVersion = w.apiVersion ?? "";
    if (!apiVersion.startsWith("4.")) continue;
    out.push({
      key,
      name: w.name ?? key,
      icon: w.icon ?? "",
      rdns: w.rdns ?? "",
      apiVersion,
    });
  }
  return out;
}

export async function connectMidnightWallet(
  key: string,
  networkId: string,
): Promise<ConnectedWallet> {
  const injected = (window as unknown as { midnight?: Record<string, unknown> }).midnight ?? {};
  const w = injected[key];
  if (!isConnectorWallet(w)) throw new Error(`wallet '${key}' not found`);
  const api = await w.connect(networkId);
  const status = await api.getConnectionStatus();
  if (status.status !== "connected") {
    throw new Error("wallet did not connect");
  }
  if (status.networkId !== networkId) {
    throw new Error(
      `wallet is on network '${status.networkId}', expected '${networkId}'. ` +
        `Switch the wallet to the ${networkId} network.`,
    );
  }
  return api;
}

// ── Local mn CLI wallet (mn serve) ──
// A synthetic picker entry: it is NOT a window.midnight provider — connecting opens a
// WebSocket to `mn serve` — but it rides the same picker so users choose it like any
// wallet. Its wallet has current dust, so it can pay a join where Lace can't.
export const MN_SERVE_KEY = "mn-serve";

export function mnServeWallet(): DetectedWallet {
  return { key: MN_SERVE_KEY, name: "mn CLI wallet (local)", icon: "", rdns: "cli.midnight.serve", apiVersion: "4.x" };
}

// anonboard uses the lowercase abstractions form; the connector wants the NetworkId enum name.
const MN_NETWORK_ID: Record<string, string> = { undeployed: "Undeployed", preprod: "PreProd", preview: "Preview" };

export async function connectMnServe(url: string, networkId: string): Promise<ConnectedWallet> {
  const mapped = MN_NETWORK_ID[networkId.toLowerCase()] ?? networkId;
  try {
    const client = await createWalletClient({ url, networkId: mapped });
    // The connector implements the full ConnectedAPI (same surface as Lace); our
    // ConnectedWallet is a hand-rolled subset, so bridge it structurally.
    return client as unknown as ConnectedWallet;
  } catch (e) {
    throw new Error(
      `couldn't reach mn serve at ${url} — start it with \`mn serve --network ${networkId}\` (${e instanceof Error ? e.message : String(e)})`,
    );
  }
}
