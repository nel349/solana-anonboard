import { useEffect, useRef, useState } from "react";
import { Keypair } from "@solana/web3.js";
import { joinViaWallet, deriveMemberPublicKey, toHexString } from "./midnight/join.ts";
import {
  detectMidnightWallets,
  connectMidnightWallet,
  type ConnectedWallet,
  type DetectedWallet,
} from "./midnight/wallet.ts";
import { ClawHero } from "./ClawHero.tsx";
import { useFeed, useSponsorBalance } from "./hooks.ts";
import { submitPost } from "./solana/post.ts";
import {
  BADGE_STORAGE_KEY,
  CONTRACT_ADDRESS,
  COST_PER_POST_SOL,
  MAX_BODY,
  NETWORK_ID,
  OPERATOR_URL,
  SPONSOR_ADDR,
} from "./config.ts";

// ── Session identity (localStorage; demo only — encrypt for production). ──
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

type Theme = "light" | "dark";
function initialTheme(): Theme {
  const saved = localStorage.getItem("anonboard.theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function App() {
  const badgeRef = useRef<Keypair>(loadOrCreateBadge());
  const badge = badgeRef.current;
  const badgePk = badge.publicKey.toBase58();
  const secretRef = useRef<Uint8Array | null>(null);

  const { posts, isMember, optimistic, addOptimistic, dropOptimistic } = useFeed(badgePk);
  const sponsorSol = useSponsorBalance();

  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("anonboard.theme", theme);
  }, [theme]);

  const [solanaOpen, setSolanaOpen] = useState(false);
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [walletName, setWalletName] = useState<string>("");
  const [pickList, setPickList] = useState<DetectedWallet[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<{ msg: string; kind: "info" | "ok" | "err" }>({
    msg: "",
    kind: "info",
  });
  const [busy, setBusy] = useState(false);
  // Reflect membership as soon as we join, without waiting for the sync node's badge
  // list to catch up to the chain (that lag is what showed "not a member" mid-join).
  const [joined, setJoined] = useState(false);
  const member = joined || isMember === true;
  // ts of the post we're confirming, so we can clear "confirming…" once it lands.
  const [pendingTs, setPendingTs] = useState<number | null>(null);
  useEffect(() => {
    if (pendingTs !== null && !optimistic.some((o) => o.ts === pendingTs)) {
      setPendingTs(null);
      setStatus((s) => (s.msg.startsWith("Posted") ? { msg: "", kind: "info" } : s));
    }
  }, [optimistic, pendingTs]);
  // Safety net: if an optimistic "joined" never becomes a real on-chain member (a join
  // that was submitted but dropped/reverted), don't trap the user in "member · syncing…"
  // with the Join button hidden — clear it after a grace period so they can retry.
  useEffect(() => {
    if (!joined || isMember === true) return;
    const t = setTimeout(() => setJoined(false), 120_000);
    return () => clearTimeout(t);
  }, [joined, isMember]);

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
      setStatus({ msg: `Connecting ${picked.name}…`, kind: "info" });
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
      const msg = e instanceof Error ? e.message : String(e);
      // "already joined" means this badge is a member on-chain — treat it as success.
      if (/already joined/i.test(msg)) {
        setJoined(true);
        setStatus({ msg: "You're already a member — waiting for the node to sync.", kind: "ok" });
      } else {
        setStatus({ msg: `Join failed: ${msg}`, kind: "err" });
      }
    } finally {
      setBusy(false);
    }
  }

  function post() {
    const body = draft.trim();
    if (!body) return;
    const ts = addOptimistic(body);
    setPendingTs(ts);
    setDraft("");
    setStatus({ msg: "Posting…", kind: "info" });
    // Don't lock the composer on the receipt — the post shows optimistically and the
    // board reflects the accept/reject verdict when it lands. Confirm in the background.
    submitPost(badge, body)
      .then((result) => {
        if (result.ok) {
          setStatus({ msg: "Posted — confirming on-chain…", kind: "ok" });
        } else {
          dropOptimistic(ts);
          setStatus({ msg: `Rejected: ${result.message}`, kind: "err" });
        }
      })
      .catch((e) => {
        dropOptimistic(ts);
        setStatus({ msg: `Error: ${e instanceof Error ? e.message : String(e)}`, kind: "err" });
      });
  }

  return (
    <div className="wrap">
      {/* Floating Solana / sponsor panel — the chain plumbing, tucked bottom-right. */}
      <div className="sol-fab">
        <button
          type="button"
          className="tab"
          onClick={() => setSolanaOpen((o) => !o)}
          aria-expanded={solanaOpen}
        >
          <span className="d" /> Solana {solanaOpen ? "▾" : "▴"}
        </button>
        {solanaOpen && (
          <div className="sol-panel">
            <p className="h">Solana — gasless posting</p>
            <div className="sol-stat">
              <span className="k">You pay</span>
              <span className="v">0 SOL</span>
            </div>
            <div className="sol-stat">
              <span className="k">Sponsor</span>
              <span className="v"><code>{shortAddr(SPONSOR_ADDR)}</code></span>
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

      {/* Full-bleed cinematic hero with an overlay bar (tagline + theme toggle). */}
      <div className="hero">
        <ClawHero />
        <div className="hero-bar">
          <p className="eyebrow">Membership on Midnight · Posting on Solana</p>
          <div className="toggle" role="group" aria-label="Theme">
            <button type="button" aria-pressed={theme === "light"} onClick={() => setTheme("light")}>
              Light
            </button>
            <button type="button" aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}>
              Dark
            </button>
          </div>
        </div>
      </div>

      <div className="stage">
        {/* Console: badge + membership + composer, overlapping up into the hero. */}
        <div className="card console">
          <div className="who">
            <div>
              <span className="label">Your anonymous badge</span>
              <code>{badgePk}</code>
            </div>
            {member ? (
              isMember === true ? (
                <span className="pill ok"><span className="d" />member</span>
              ) : (
                <span className="pill ok"><span className="d" />member · syncing…</span>
              )
            ) : isMember === null ? (
              <span className="pill"><span className="d" />checking</span>
            ) : (
              <span className="pill warn"><span className="d" />not a member</span>
            )}
          </div>

          <div className="compose">
            <textarea
              value={draft}
              maxLength={MAX_BODY}
              placeholder="Say something…"
              aria-label="Post body"
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
            />
            <div className="row">
              <span className="count">{draft.length}/{MAX_BODY}</span>
              <button onClick={post} disabled={busy || !draft.trim()}>
                {busy ? "Posting…" : "Post"}
              </button>
            </div>
          </div>

          {status.msg && (
            <p
              className={`status ${status.kind}`}
              role={status.kind === "err" ? "alert" : "status"}
            >
              {status.msg}
            </p>
          )}

          {!member && isMember !== null && (
            <div className="join-row">
              {wallet ? (
                <>
                  <button onClick={join} disabled={busy}>{busy ? "Joining…" : "Join"}</button>
                  <span className="note">Prove membership — your wallet pays the Midnight fee.</span>
                </>
              ) : pickList.length > 0 ? (
                pickList.map((w) => (
                  <button key={w.key} className="secondary" onClick={() => doConnect(w)} disabled={busy}>
                    {w.name}
                  </button>
                ))
              ) : (
                <>
                  <button className="secondary" onClick={connect} disabled={busy}>
                    {busy ? "Connecting…" : "Connect wallet"}
                  </button>
                  <span className="note">to join and prove membership.</span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="board-head">
          <h2>Board</h2>
          <span className="line" />
        </div>

        <section className="feed">
          {posts.length === 0 && optimistic.length === 0 && <p className="empty">No posts yet.</p>}
          {optimistic
            .filter((o) => !posts.some((p) => p.body === o.body && p.author === badgePk))
            .map((o) => (
              <article key={`opt-${o.ts}`} className="post pending">
                <div className="post-head">
                  <span className="who">sending…</span>
                  <span className="reason">confirming</span>
                </div>
                <p className="body">{o.body}</p>
              </article>
            ))}
          {posts.map((p) => (
            <article key={p.id} className={p.accepted ? "post" : "post rej"}>
              <div className="post-head">
                <span className="who">{p.accepted ? "member" : "not a member"}</span>
                <span className="reason">
                  {p.accepted ? "joined on Midnight" : "not joined on Midnight"}
                </span>
              </div>
              <p className="body">{p.body}</p>
            </article>
          ))}
        </section>

        <footer>Solana + Midnight, one EffectStream state machine.</footer>
      </div>
    </div>
  );
}
