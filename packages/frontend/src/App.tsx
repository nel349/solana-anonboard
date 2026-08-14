import { useEffect, useRef, useState } from "react";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import bs58 from "bs58";
import {
  createPostInstruction,
  DEV_BATCHER_FEE_PAYER,
  DEV_BATCHER_TARGET,
  DEV_BATCHER_URL,
  DEV_NODE_API_URL,
  DEV_OPERATOR_URL,
  DEV_RPC_URL,
} from "@solana-anonboard/contracts-solana";
import { joinViaWallet, deriveMemberPublicKey, toHexString } from "./midnight/join.ts";
import {
  detectMidnightWallets,
  connectMidnightWallet,
  type ConnectedWallet,
  type DetectedWallet,
} from "./midnight/wallet.ts";
// Rewritten on every deploy; importing the JSON lets HMR pick up the new address.
import contractInfo from "../../contracts-midnight/contract-anonboard.undeployed.json";

const RPC = DEV_RPC_URL;
const BATCHER_URL = DEV_BATCHER_URL;
const POSTS_URL = `${DEV_NODE_API_URL}/api/posts`;
const BADGES_URL = `${DEV_NODE_API_URL}/api/badges`;
const SPONSOR = new PublicKey(DEV_BATCHER_FEE_PAYER);
const ADDRESS_TYPE_SOLANA = 9; // AddressType.SOLANA
const MAX_BODY = 280; // bounded by the Solana tx size (see DECISIONS.md D9)

// Sponsor pays 5,000 lamports/signature × 2 sigs per post; author pays nothing.
const LAMPORTS_PER_SIGNATURE = 5000;
const SIGNATURES_PER_POST = 2; // badge author + sponsor fee-payer
const COST_PER_POST_LAMPORTS = LAMPORTS_PER_SIGNATURE * SIGNATURES_PER_POST;
const COST_PER_POST_SOL = COST_PER_POST_LAMPORTS / LAMPORTS_PER_SOL;

// Anonymous session identity, unlinkable to the on-chain member (DECISIONS.md D4). Not the user's wallet.
const BADGE_STORAGE_KEY = "anonboard.badge.v1";

// The membership secret (32 bytes) is the roster identity, separate from the
// badge. It is generated and kept in the browser; deriving its public key and
// proving `join` both happen client-side, so the operator never sees it.
// Plaintext localStorage is for the demo only; a real build must encrypt it.
const CONTRACT_ADDRESS = contractInfo.contractAddress;
const NETWORK_ID = "undeployed";

// The membership secret is keyed by the connected wallet's stable coin public
// key, so the same wallet always maps to the same roster member (signData is not
// guaranteed deterministic, so we don't derive from a signature). Kept in
// localStorage for the demo; encrypt for production.
function loadOrCreateSecretForWallet(coinPublicKey: string): Uint8Array {
  const key = `anonboard.secret.v2.${coinPublicKey}`;
  const saved = localStorage.getItem(key);
  if (saved) {
    try {
      return Uint8Array.from(JSON.parse(saved));
    } catch {}
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
    } catch {}
  }
  const kp = Keypair.generate();
  localStorage.setItem(BADGE_STORAGE_KEY, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

function shortAddr(a: string): string {
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

type Post = {
  id: number;
  author: string;
  body: string;
  accepted: boolean;
  reason: string;
  block_height: number;
};

export function App() {
  const badgeRef = useRef<Keypair>(loadOrCreateBadge());
  const badge = badgeRef.current;
  const badgePk = badge.publicKey.toBase58();
  const secretRef = useRef<Uint8Array | null>(null);

  const [posts, setPosts] = useState<Post[]>([]);
  const [isMember, setIsMember] = useState<boolean | null>(null);
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [walletName, setWalletName] = useState<string>("");
  const [pickList, setPickList] = useState<DetectedWallet[]>([]);
  const [sponsorSol, setSponsorSol] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<{ msg: string; kind: "info" | "ok" | "err" }>({
    msg: "",
    kind: "info",
  });
  const [busy, setBusy] = useState(false);
  // Optimistic rows; each dropped once its real row (same body+badge) arrives from the sync.
  const [optimistic, setOptimistic] = useState<{ body: string; ts: number }[]>([]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const [pRes, bRes] = await Promise.all([fetch(POSTS_URL), fetch(BADGES_URL)]);
        const pJson = await pRes.json();
        const bJson = await bRes.json();
        if (!alive) return;
        const realPosts: Post[] = pJson.posts ?? [];
        setPosts(realPosts);
        setIsMember((bJson.badges ?? []).some((b: { pubkey: string }) => b.pubkey === badgePk));
        setOptimistic((prev) =>
          prev.filter((o) => !realPosts.some((p) => p.body === o.body && p.author === badgePk)),
        );
      } catch {}
    };
    tick();
    // Poll the feed every 500ms so the board reflects the sub-second sync
    // quickly. A production build could subscribe to the sync's MQTT push
    // (ws://127.0.0.1:9883, RollupBlock) instead of polling.
    const h = setInterval(tick, 500);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, [badgePk]);

  useEffect(() => {
    let alive = true;
    const conn = new Connection(RPC, "confirmed");
    const tick = async () => {
      try {
        const lamports = await conn.getBalance(SPONSOR, "confirmed");
        if (alive) setSponsorSol(lamports / LAMPORTS_PER_SOL);
      } catch {}
    };
    tick();
    const h = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, []);

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

  // Operator must add the member to the roster BEFORE the browser can prove join — the circuit asserts membership.
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
      const reg = await fetch(`${DEV_OPERATOR_URL}/register`, {
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
    const ts = Date.now();
    setOptimistic((prev) => [{ body, ts }, ...prev]);
    setDraft("");
    setBusy(true);
    setStatus({ msg: "Signing (you pay 0 SOL)…", kind: "info" });
    try {
      const conn = new Connection(RPC, "confirmed");
      const { blockhash } = await conn.getLatestBlockhash("confirmed");
      const tx = new Transaction();
      tx.feePayer = SPONSOR;
      tx.recentBlockhash = blockhash;
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 80_000 }));
      tx.add(createPostInstruction(badge.publicKey, body));
      tx.partialSign(badge);
      const b64 = tx.serialize({ requireAllSignatures: false }).toString("base64");
      const sig = tx.signatures.find((s) => s.publicKey.equals(badge.publicKey))?.signature;

      setStatus({ msg: "Sending to the batcher (sponsor co-signs + pays)…", kind: "info" });
      const res = await fetch(`${BATCHER_URL}/send-input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: {
            target: DEV_BATCHER_TARGET,
            address: badgePk,
            addressType: ADDRESS_TYPE_SOLANA,
            input: b64,
            signature: sig ? bs58.encode(sig) : "",
            timestamp: Date.now().toString(),
          },
          confirmationLevel: "wait-receipt",
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOptimistic((prev) => prev.filter((o) => o.ts !== ts));
        setStatus({ msg: `Batcher rejected: ${j.message ?? res.status}`, kind: "err" });
      } else {
        setStatus({
          msg: isMember
            ? "Posted — confirming on-chain…"
            : "Posted — confirming on-chain (shows 'not a member' until you join)…",
          kind: "ok",
        });
      }
    } catch (e) {
      setOptimistic((prev) => prev.filter((o) => o.ts !== ts));
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
            <code>{shortAddr(DEV_BATCHER_FEE_PAYER)}</code>
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
        {status.msg && <p className={`status ${status.kind}`}>{status.msg}</p>}
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
                {p.accepted
                  ? "joined on Midnight"
                  : "badge has not joined on Midnight"}
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
