// Floating Solana / sponsor panel — the chain plumbing, tucked bottom-right.
import { shortAddr } from "../session.ts";
import { COST_PER_POST_SOL, SPONSOR_ADDR } from "../config.ts";

export function SolanaPanel({
  sponsorSol,
  open,
  onToggle,
}: {
  sponsorSol: number | null;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="sol-fab">
      <button type="button" className="tab" onClick={onToggle} aria-expanded={open}>
        <span className="d" /> Solana {open ? "▾" : "▴"}
      </button>
      {open && (
        <div className="sol-panel">
          <p className="h">Solana — gasless posting</p>
          <div className="sol-stat">
            <span className="k">You pay</span>
            <span className="v">0 SOL</span>
          </div>
          <div className="sol-stat">
            <span className="k">Sponsor</span>
            <span className="v">
              <code>{shortAddr(SPONSOR_ADDR)}</code>
            </span>
            <span className="sub">covers every post's fee</span>
          </div>
          <div className="sol-stat">
            <span className="k">Sponsor balance</span>
            <span className="v">{sponsorSol === null ? "…" : `${sponsorSol.toFixed(5)} SOL`}</span>
            <span className="sub">
              {sponsorSol === null
                ? "reading…"
                : `~${Math.floor(sponsorSol / COST_PER_POST_SOL).toLocaleString()} more posts`}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
