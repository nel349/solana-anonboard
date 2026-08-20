// The join flow: the operator registers the member key on the roster, then the browser
// proves the join and the connected wallet pays + submits. Owns the optimistic "joined"
// flag (so membership shows immediately, before the sync node catches up).
import { useEffect, useState } from "react";
import type { Keypair } from "@solana/web3.js";
import { joinViaWallet, deriveMemberPublicKey, toHexString } from "./midnight/join.ts";
import type { ConnectedWallet } from "./midnight/wallet.ts";
import { CONTRACT_ADDRESS, OPERATOR_URL } from "./config.ts";
import type { SetStatus } from "./useAppStatus.ts";

// dApp-connector / Effect failures often wrap the real reason behind an empty
// top-level `.message`. Walk the cause chain so the innermost tag/message surfaces.
function extractErrorMessage(e: unknown): string {
  let node: unknown = e;
  let tag: string | undefined;
  let reason = "";
  for (let d = 0; node && d < 10; d++) {
    const o = node as Record<string, unknown>;
    if (typeof o._tag === "string") tag = o._tag;
    if (typeof o.message === "string" && o.message) reason = o.message;
    node = o.cause ?? o.failure ?? o.error;
  }
  return reason || tag || (e instanceof Error && e.message) || String(e);
}

export type JoinFlow = {
  joined: boolean;
  busy: boolean;
  join: () => Promise<void>;
};

export function useJoin(opts: {
  wallet: ConnectedWallet | null;
  walletName: string;
  badge: Keypair;
  secret: Uint8Array | null;
  isMember: boolean | null;
  setStatus: SetStatus;
}): JoinFlow {
  const { wallet, walletName, badge, secret, isMember, setStatus } = opts;
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);

  // Safety net: if an optimistic "joined" never becomes a real on-chain member (a join
  // submitted but dropped/reverted), clear it after a grace period so the user isn't
  // trapped in "member · syncing…" with the Join button hidden — they can retry.
  useEffect(() => {
    if (!joined || isMember === true) return;
    const t = setTimeout(() => setJoined(false), 120_000);
    return () => clearTimeout(t);
  }, [joined, isMember]);

  async function join(): Promise<void> {
    if (!wallet || !secret) {
      setStatus({ msg: "Connect your wallet first.", kind: "err" });
      return;
    }
    setBusy(true);
    try {
      setStatus({ msg: "Registering your membership key…", kind: "info" });
      const memberPkHex = toHexString(deriveMemberPublicKey(secret));
      const reg = await fetch(`${OPERATOR_URL}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberPkHex }),
      }).then((r) => r.json());
      if (!reg.ok) throw new Error(reg.error ?? "register failed");

      setStatus({ msg: `Proving membership — approve in ${walletName}…`, kind: "info" });
      await joinViaWallet(wallet, badge.publicKey.toBytes(), secret, CONTRACT_ADDRESS);

      setJoined(true);
      setStatus({ msg: "Joined. Your badge becomes a member once the node syncs.", kind: "ok" });
    } catch (e) {
      console.error("[join] failed:", e);
      const msg = extractErrorMessage(e);
      // "already joined" means this badge is a member on-chain — treat it as success.
      if (/already joined/i.test(msg)) {
        setJoined(true);
        setStatus({ msg: "You're already a member — waiting for the node to sync.", kind: "ok" });
      } else {
        setStatus({ msg: `Join failed: ${msg || "unknown error — see console"}`, kind: "err" });
      }
    } finally {
      setBusy(false);
    }
  }

  return { joined, busy, join };
}
