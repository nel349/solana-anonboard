// Midnight wallet connection: detect installed wallets, connect one, and derive the
// per-wallet membership secret. Owns only connection state — join/post live elsewhere.
import { useState } from "react";
import {
  detectMidnightWallets,
  connectMidnightWallet,
  type ConnectedWallet,
  type DetectedWallet,
} from "../midnight/wallet.ts";
import { loadOrCreateSecretForWallet } from "../session.ts";
import { NETWORK_ID } from "../config.ts";
import type { SetStatus } from "./useAppStatus.ts";

export type WalletConnection = {
  wallet: ConnectedWallet | null;
  walletName: string;
  secret: Uint8Array | null;
  pickList: DetectedWallet[];
  busy: boolean;
  connect: () => void;
  doConnect: (picked: DetectedWallet) => Promise<void>;
};

export function useWalletConnection(setStatus: SetStatus): WalletConnection {
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [walletName, setWalletName] = useState("");
  const [secret, setSecret] = useState<Uint8Array | null>(null);
  const [pickList, setPickList] = useState<DetectedWallet[]>([]);
  const [busy, setBusy] = useState(false);

  // Detect wallets: none → prompt to install; one → connect it; many → show a picker.
  function connect(): void {
    const found = detectMidnightWallets();
    if (found.length === 0) {
      setStatus({ msg: "No Midnight wallet found. Install Lace or 1AM and reload.", kind: "err" });
      return;
    }
    if (found.length === 1) {
      void doConnect(found[0]);
      return;
    }
    setPickList(found);
  }

  async function doConnect(picked: DetectedWallet): Promise<void> {
    setPickList([]);
    setBusy(true);
    try {
      setStatus({ msg: `Connecting ${picked.name}…`, kind: "info" });
      const w = await connectMidnightWallet(picked.key, NETWORK_ID);
      const addrs = await w.getShieldedAddresses();
      setSecret(loadOrCreateSecretForWallet(addrs.shieldedCoinPublicKey));
      setWallet(w);
      setWalletName(picked.name);
      setStatus({ msg: `Connected ${picked.name}.`, kind: "ok" });
    } catch (e) {
      setStatus({ msg: `Connect failed: ${e instanceof Error ? e.message : String(e)}`, kind: "err" });
    } finally {
      setBusy(false);
    }
  }

  return { wallet, walletName, secret, pickList, busy, connect, doConnect };
}
