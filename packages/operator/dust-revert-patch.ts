// SDK workaround: make dust revert safe after a rejected transaction.
//
// SDK BUG (@midnightntwrk/wallet-sdk-dust-wallet 4.2.0):
//   1. DustLocalState.spend() (WASM) consumes the UTXO from state.utxos during
//      balancing — the coin leaves local state before the tx reaches the chain.
//   2. On rejection the wallet's revert path clears pending tracking but does NOT
//      restore the pre-spend DustLocalState, so the spent UTXO is gone.
//   Combined effect: after the node rejects a balanced transaction (e.g. a stale
//   dust spend proof, error 170), the operator's dust is permanently unavailable
//   until new dust is generated on-chain — the next add_to_roster then fails with
//   "could not balance dust" (InsufficientFunds) even though dust regenerates each
//   block. A correct revert should snapshot and restore pre-spend state.
//
// Fix — patch three CoreWallet statics (CoreWallet is `export const CoreWallet = {…}`,
// a namespace of pure functions that all take the wallet as their first argument):
//   1. spendCoins        — snapshot DustLocalState BEFORE the WASM spend consumes it
//   2. revertTransaction — restore the pre-spend DustLocalState from the snapshot,
//                          returning the UTXO and clearing the reverted pendingDust
//   3. applyEventsWithChanges — drop snapshots once their coins confirm on-chain
//
// The facade routes both its submit-failure catch and its constructor auto-revert
// through CoreWallet.revertTransaction, so patching the static intercepts every path.
//
// ON SDK UPGRADE: verify CoreWallet still exports spendCoins, revertTransaction,
// applyFailed, applyEventsWithChanges, and pendingDustToMap with these signatures
// (see node_modules/@midnightntwrk/wallet-sdk-dust-wallet/dist/v1/CoreWallet.d.ts).
// If a rejected write recovers without this patch, the SDK bug is fixed — remove it.
//
// Applied once at import time; affects every facade built afterward. Import this
// module BEFORE building any wallet facade.

import { DustLocalState } from "@midnight-ntwrk/ledger-v8";
import { CoreWallet } from "@midnightntwrk/wallet-sdk-dust-wallet/v1";

// nullifier → serialized pre-spend DustLocalState. Cleared on revert (rejection)
// and on applyEventsWithChanges (on-chain confirmation).
const preSpendSnapshots = new Map<unknown, Uint8Array>();

// ── applyEventsWithChanges: drop snapshots once their coins confirm on-chain ──
const _originalApplyEventsWithChanges = CoreWallet.applyEventsWithChanges;
CoreWallet.applyEventsWithChanges = function patchedApplyEventsWithChanges(
  wallet: any, secretKey: any, events: any, currentTime: any,
): any {
  const result = _originalApplyEventsWithChanges.call(CoreWallet, wallet, secretKey, events, currentTime);
  const updatedWallet = Array.isArray(result) ? result[0] : result;
  if (preSpendSnapshots.size > 0 && updatedWallet?.pendingDust) {
    const stillPending = new Set(updatedWallet.pendingDust.map((t: any) => t.nullifier));
    for (const nullifier of preSpendSnapshots.keys()) {
      if (!stillPending.has(nullifier)) preSpendSnapshots.delete(nullifier);
    }
  }
  return result;
};

// ── spendCoins: snapshot pre-spend state ──
const _originalSpendCoins = CoreWallet.spendCoins;
CoreWallet.spendCoins = function patchedSpendCoins(
  wallet: any, secretKey: any, coins: any, currentTime: any,
): any {
  let snapshot: Uint8Array | null = null;
  try { snapshot = wallet.state.serialize(); } catch { /* best-effort */ }

  const result = _originalSpendCoins.call(CoreWallet, wallet, secretKey, coins, currentTime);

  // result = [dustSpends[], updatedWallet]
  const updatedWallet = result[1] ?? result;
  if (snapshot && updatedWallet?.pendingDust) {
    for (const pending of updatedWallet.pendingDust) {
      if (!preSpendSnapshots.has(pending.nullifier)) {
        preSpendSnapshots.set(pending.nullifier, snapshot);
      }
    }
  }
  return result;
};

// ── revertTransaction: restore pre-spend state ──
const _originalRevert = CoreWallet.revertTransaction;
CoreWallet.revertTransaction = function safeRevertTransaction(wallet: any, tx: any): any {
  const pendingSpendsMap = CoreWallet.pendingDustToMap(wallet.pendingDust);
  const removedNullifiers: unknown[] = [];

  const intents = tx.intents;
  if (intents) {
    for (const intent of intents.values()) {
      const spends = intent.dustActions?.spends;
      if (!spends) continue;
      for (const spend of spends) {
        if (pendingSpendsMap.has(spend.oldNullifier)) removedNullifiers.push(spend.oldNullifier);
      }
    }
  }

  let restoredState = wallet.state;
  for (const nullifier of removedNullifiers) {
    const snapshot = preSpendSnapshots.get(nullifier);
    if (snapshot) {
      try { restoredState = DustLocalState.deserialize(snapshot); } catch { /* keep current state */ }
      preSpendSnapshots.delete(nullifier);
    }
  }

  return {
    ...wallet,
    state: restoredState,
    pendingDust: wallet.pendingDust.filter(
      (token: any) => !removedNullifiers.includes(token.nullifier),
    ),
  };
};

// applyFailed is the rejection path's alias for revertTransaction — keep them identical.
CoreWallet.applyFailed = CoreWallet.revertTransaction as typeof CoreWallet.applyFailed;

export { _originalRevert as originalRevertTransaction };
