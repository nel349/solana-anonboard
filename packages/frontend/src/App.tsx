import { useRef, useState } from "react";
import { Keypair } from "@solana/web3.js";
import { joinViaWallet, deriveMemberPublicKey, toHexString } from "./midnight/join.ts";
import {
  detectMidnightWallets,
  connectMidnightWallet,
  type ConnectedWallet,
  type DetectedWallet,
} from "./midnight/wallet.ts";
import { useFeed, useSponsorBalance } from "./hooks.ts";
import { submitPost } from "./solana/post.ts";
import {
  BADGE_STORAGE_KEY,
  CONTRACT_ADDRESS,
  COST_PER_POST_LAMPORTS,
  COST_PER_POST_SOL,
  MAX_BODY,
  NETWORK_ID,
  OPERATOR_URL,
  SPONSOR_ADDR,
} from "./config.ts";

// ── Session identity (localStorage; demo only — encrypt for production). ──
// The membership secret is keyed by the connected wallet's stable coin public key,
// so the same wallet always maps to the same roster member.
function loadOrCreateSecretForWallet(coinPublicKey: string): Uint8Array {
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

function loadOrCreateBadge(): Keypair {
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

function shortAddr(a: string): string {
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

export function App() {
  const badgeRef = useRef<Keypair>(loadOrCreateBadge());
  const badge = badgeRef.current;
  const badgePk = badge.publicKey.toBase58();
  const secretRef = useRef<Uint8Array | null>(null);

  const { posts, isMember, optimistic, addOptimistic, dropOptimistic } = useFeed(badgePk);
  const sponsorSol = useSponsorBalance();

  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [walletName, setWalletName] = useState<string>("");
  const [pickList, setPickList] = useState<DetectedWallet[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<{ msg: string; kind: "info" | "ok" | "err" }>({
    msg: "",
    kind: "info",
  });
  const [busy, setBusy] = useState(false);

  function connect() {
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

  async function doConnect(picked: DetectedWallet) {
    setPickList([]);
    setBusy(true);
    try {
      setStatus({ msg: `Connecting ${picked.name} — approve in the wallet…`, kind: "info" });
      const w = await connectMidnightWallet(picked.key, NETWORK_ID);
      const addrs = await w.getShieldedAddresses();
      secretRef.current = loadOrCreateSecretForWallet(addrs.shieldedCoinPublicKey);
      setWallet(w);
      setWalletName(picked.name);
      setStatus({ msg: `Connected ${picked.name}.`, kind: "ok" });
    } catch (e) {
      setStatus({ msg: `Connect failed: ${e instanceof Error ? e.message : String(e)}`, kind: "err" });
    } finally {
      setBusy(false);
    }
  }

  // Operator adds the member to the roster; then the browser proves join and the
  // connected wallet pays + submits.
  async function join() {
    if (!wallet || !secretRef.current) {
      setStatus({ msg: "Connect your wallet first.", kind: "err" });
      return;
    }
    const secret = secretRef.current;
    setBusy(true);
    try {
      setStatus({ msg: "Registering your membership key on the roster…", kind: "info" });
      const memberPkHex = toHexString(deriveMemberPublicKey(secret));
      const reg = await fetch(`${OPERATOR_URL}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberPkHex }),
      }).then((r) => r.json());
      if (!reg.ok) throw new Error(reg.error ?? "register failed");

      setStatus({
        msg: `Proving membership in your browser; approve in ${walletName} to pay + submit…`,
        kind: "info",
      });
      await joinViaWallet(wallet, badge.publicKey.toBytes(), secret, CONTRACT_ADDRESS);

      setStatus({
        msg: "Joined with your wallet. Your badge becomes a member once the node syncs it.",
        kind: "ok",
      });
    } catch (e) {
      setStatus({ msg: `Join failed: ${e instanceof Error ? e.message : String(e)}`, kind: "err" });
    } finally {
      setBusy(false);
    }
  }

  async function post() {
    const body = draft.trim();
    if (!body) return;
    const ts = addOptimistic(body);
    setDraft("");
    setBusy(true);
    setStatus({ msg: "Signing + sending (you pay 0 SOL)…", kind: "info" });
    try {
      const result = await submitPost(badge, body);
      if (!result.ok) {
        dropOptimistic(ts);
        setStatus({ msg: `Batcher rejected: ${result.message}`, kind: "err" });
      } else {
        setStatus({
          msg: isMember
            ? "Posted — confirming on-chain…"
            : "Posted — confirming on-chain (shows 'not a member' until you join)…",
          kind: "ok",
        });
      }
    } catch (e) {
      dropOptimistic(ts);
      setStatus({ msg: `Error: ${e instanceof Error ? e.message : String(e)}`, kind: "err" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap">
      <header>
        <h1>anonboard</h1>
        <p className="tag">
          Every member post is provably from someone on the Midnight roster. No post
          can be traced back to a person, not even by whoever runs the servers.
        </p>
      </header>

      <section className="me">
        <div>
          <span className="label">Your anonymous badge</span>
          <code>{badgePk}</code>
        </div>
        <div>
          {isMember === null ? (
            <span className="pill">checking…</span>
          ) : isMember ? (
            <span className="pill ok">member</span>
          ) : (
            <span className="pill warn">not a member</span>
          )}
        </div>
      </section>

      <section className="stats">
        <div className="stat">
          <span className="k">Sponsor account</span>
          <span className="v">
            <code>{shortAddr(SPONSOR_ADDR)}</code>
          </span>
          <span className="sub">pays every post's fee so you don't</span>
        </div>
        <div className="stat">
          <span className="k">Sponsor balance</span>
          <span className="v">
            {sponsorSol === null ? "…" : `${sponsorSol.toFixed(5)} SOL`}
          </span>
          <span className="sub">
            {sponsorSol === null
              ? "reading from the chain…"
              : `funds ~${Math.floor(sponsorSol / COST_PER_POST_SOL).toLocaleString()} more posts`}
          </span>
        </div>
        <div className="stat">
          <span className="k">Cost per post</span>
          <span className="v">You: 0 SOL</span>
          <span className="sub">
            sponsor pays {COST_PER_POST_SOL.toFixed(5)} SOL ({COST_PER_POST_LAMPORTS.toLocaleString()} lamports)
          </span>
        </div>
      </section>

      {!isMember && isMember !== null && (
        <div className="hint">
          <p>
            Your badge has not joined on Midnight yet. You can still post, but the board
            marks it <strong>not a member</strong> until you join — that is the
            cross-chain check working, not an error. Connect your Midnight wallet to
            prove membership; the proof runs in your browser and the wallet pays the fee.
          </p>
          {wallet ? (
            <>
              <p className="wallet-line">
                Connected: <strong>{walletName}</strong>
              </p>
              <button className="join" onClick={join} disabled={busy}>
                {busy ? "Joining…" : `Join with ${walletName}`}
              </button>
            </>
          ) : pickList.length > 0 ? (
            <div className="wallet-pick">
              <p className="wallet-line">Choose a wallet:</p>
              {pickList.map((w) => (
                <button key={w.key} className="join" onClick={() => doConnect(w)} disabled={busy}>
                  {w.name}
                </button>
              ))}
            </div>
          ) : (
            <button className="join" onClick={connect} disabled={busy}>
              {busy ? "Connecting…" : "Connect wallet"}
            </button>
          )}
        </div>
      )}

      <section className="composer">
        <textarea
          value={draft}
          maxLength={MAX_BODY}
          placeholder="Say something…"
          aria-label="Post body"
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
        />
        <div className="row">
          <span className="count">
            {draft.length}/{MAX_BODY}
          </span>
          <button onClick={post} disabled={busy || !draft.trim()}>
            {busy ? "Posting…" : "Post — you pay 0 SOL"}
          </button>
        </div>
        {status.msg && (
          // Primary feedback channel — announce to screen readers (assertive for
          // errors) and don't rely on color alone.
          <p
            className={`status ${status.kind}`}
            role={status.kind === "err" ? "alert" : "status"}
          >
            {status.msg}
          </p>
        )}
      </section>

      <section className="feed">
        <h2>Board</h2>
        {posts.length === 0 && optimistic.length === 0 && <p className="empty">No posts yet.</p>}
        {optimistic
          .filter((o) => !posts.some((p) => p.body === o.body && p.author === badgePk))
          .map((o) => (
            <article key={`opt-${o.ts}`} className="post pending">
              <div className="post-head">
                <span className="who">sending…</span>
                <span className="reason">confirming on Solana + Midnight</span>
              </div>
              <p className="body">{o.body}</p>
            </article>
          ))}
        {posts.map((p) => (
          <article key={p.id} className={p.accepted ? "post ok" : "post rej"}>
            <div className="post-head">
              <span className="who">{p.accepted ? "member" : "not a member"}</span>
              <span className="reason">
                {p.accepted ? "joined on Midnight" : "badge has not joined on Midnight"}
              </span>
            </div>
            <p className="body">{p.body}</p>
          </article>
        ))}
      </section>

      <footer>
        <span>Solana + Midnight, joined by one EffectStream state machine.</span>
      </footer>
    </div>
  );
}
