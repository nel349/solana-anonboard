// Browser-local identity: the anonymous badge (a Solana keypair) and the per-wallet
// membership secret. Persisted in localStorage — demo only; encrypt for production.
import { Keypair } from "@solana/web3.js";
import { BADGE_STORAGE_KEY } from "./config.ts";

export function loadOrCreateBadge(): Keypair {
  const saved = localStorage.getItem(BADGE_STORAGE_KEY);
  if (saved) {
    try {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(saved)));
    } catch (e) {
      console.warn("[anonboard] stored badge unreadable, regenerating:", e);
    }
  }
  const kp = Keypair.generate();
  localStorage.setItem(BADGE_STORAGE_KEY, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

// One membership secret per connected wallet (keyed by its shielded coin public key),
// so the same person reuses the same roster identity across sessions.
export function loadOrCreateSecretForWallet(coinPublicKey: string): Uint8Array {
  const key = `anonboard.secret.v2.${coinPublicKey}`;
  const saved = localStorage.getItem(key);
  if (saved) {
    try {
      return Uint8Array.from(JSON.parse(saved));
    } catch (e) {
      console.warn("[anonboard] stored member secret unreadable, regenerating:", e);
    }
  }
  const sk = crypto.getRandomValues(new Uint8Array(32));
  localStorage.setItem(key, JSON.stringify(Array.from(sk)));
  return sk;
}

export function shortAddr(a: string): string {
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}
