// Midnight wallet connection via the dApp-connector-api (v4).
//
// Any wallet the user has installed injects an InitialAPI under
// window.midnight[<key>]: { rdns, name, icon, apiVersion, connect(networkId) }.
// We detect every 4.x wallet (Lace, 1AM, …), let the user pick, and connect.
// connect() triggers the wallet's own approval popup — that is the identity
// prompt. A connected wallet then proves, pays, and submits the join itself
// (see joinViaWallet in ./join.ts).

export type DetectedWallet = {
  key: string; // the window.midnight key
  name: string;
  icon: string;
  rdns: string;
  apiVersion: string;
};

// The subset of the connected API we use. Kept local so we don't hard-depend on
// the connector's type package at build time.
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

// Detect installed connector wallets. Filters to major version 4 (the version
// this app targets); other majors have a different method surface.
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

// Connect to a detected wallet. Triggers the wallet's approval popup. Verifies
// the wallet is on the expected network before handing it back.
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
