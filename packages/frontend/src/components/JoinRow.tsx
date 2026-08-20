// The join call-to-action, shown only to non-members. Three states: connected (Join),
// multiple wallets detected (pick one), or not connected (Connect).
import type { ConnectedWallet, DetectedWallet } from "../midnight/wallet.ts";

export function JoinRow({
  wallet,
  pickList,
  busy,
  onConnect,
  onJoin,
  onPick,
}: {
  wallet: ConnectedWallet | null;
  pickList: DetectedWallet[];
  busy: boolean;
  onConnect: () => void;
  onJoin: () => void;
  onPick: (w: DetectedWallet) => void;
}) {
  return (
    <div className="join-row">
      {wallet ? (
        <>
          <button onClick={onJoin} disabled={busy}>
            {busy ? "Joining…" : "Join"}
          </button>
          <span className="note">Prove membership — your wallet pays the Midnight fee.</span>
        </>
      ) : pickList.length > 0 ? (
        pickList.map((w) => (
          <button key={w.key} className="secondary" onClick={() => onPick(w)} disabled={busy}>
            {w.name}
          </button>
        ))
      ) : (
        <>
          <button className="secondary" onClick={onConnect} disabled={busy}>
            {busy ? "Connecting…" : "Connect wallet"}
          </button>
          <span className="note">to join and prove membership.</span>
        </>
      )}
    </div>
  );
}
