import { useEffect, useRef, useState } from "react";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import bs58 from "bs58";
import {
  createPostInstruction,
  DEV_BATCHER_FEE_PAYER,
  DEV_BATCHER_TARGET,
  DEV_BATCHER_URL,
  DEV_NODE_API_URL,
  DEV_RPC_URL,
} from "@solana-starter/contracts-solana";

// ── Stack endpoints (the running `bun run dev` dev stack) ───────────────────
const RPC = DEV_RPC_URL;
const BATCHER_URL = DEV_BATCHER_URL;
const POSTS_URL = `${DEV_NODE_API_URL}/api/posts`;
const BADGES_URL = `${DEV_NODE_API_URL}/api/badges`;
const SPONSOR = new PublicKey(DEV_BATCHER_FEE_PAYER);
const ADDRESS_TYPE_SOLANA = 9; // AddressType.SOLANA
const MAX_BODY = 280; // bounded by the Solana tx size (see DECISIONS.md D9)

// The badge is a fresh keypair generated in the browser and kept in
// localStorage. It is the anonymous session identity: unlinkable to the member
// on-chain (see DECISIONS.md D4). Not the user's real wallet, by design.
const BADGE_STORAGE_KEY = "anonboard.badge.v1";

function loadOrCreateBadge(): Keypair {
  const saved = localStorage.getItem(BADGE_STORAGE_KEY);
  if (saved) {
    try {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(saved)));
    } catch {
      /* fall through and regenerate */
    }
  }
  const kp = Keypair.generate();
  localStorage.setItem(BADGE_STORAGE_KEY, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
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

  const [posts, setPosts] = useState<Post[]>([]);
  const [isMember, setIsMember] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<{ msg: string; kind: "info" | "ok" | "err" }>({
    msg: "",
    kind: "info",
  });
  const [busy, setBusy] = useState(false);

  // Poll the node for the feed and this badge's membership. The board is a
  // public read: no wallet needed to look.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const [pRes, bRes] = await Promise.all([fetch(POSTS_URL), fetch(BADGES_URL)]);
        const pJson = await pRes.json();
        const bJson = await bRes.json();
        if (!alive) return;
        setPosts(pJson.posts ?? []);
        setIsMember((bJson.badges ?? []).some((b: { pubkey: string }) => b.pubkey === badgePk));
      } catch {
        /* stack not up yet; keep polling */
      }
    };
    tick();
    const h = setInterval(tick, 2500);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, [badgePk]);

  async function post() {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    setStatus({ msg: "Signing (you pay 0 SOL)…", kind: "info" });
    try {
      const conn = new Connection(RPC, "confirmed");
      const { blockhash } = await conn.getLatestBlockhash("confirmed");
      const tx = new Transaction();
      tx.feePayer = SPONSOR; // the batcher pays, not the badge
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
        setStatus({ msg: `Batcher rejected: ${j.message ?? res.status}`, kind: "err" });
      } else {
        setDraft("");
        setStatus({
          msg: isMember
            ? "Posted. It will show as verified shortly."
            : "Posted. Your badge is not a verified member yet, so it will show as not-verified until you join.",
          kind: "ok",
        });
      }
    } catch (e) {
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
          Every post is provably from a verified member. No post can be traced to a
          person, not even by whoever runs the servers.
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
            <span className="pill ok">verified member</span>
          ) : (
            <span className="pill warn">not a member yet</span>
          )}
        </div>
      </section>

      {!isMember && isMember !== null && (
        <p className="hint">
          To become a verified member, an organizer adds your badge to the roster on
          Midnight (the join proof runs against it). Until then you can still post, but
          the board marks it not-verified so you can watch the check working.
        </p>
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
            {busy ? "Posting…" : "Post (0 SOL)"}
          </button>
        </div>
        {status.msg && <p className={`status ${status.kind}`}>{status.msg}</p>}
      </section>

      <section className="feed">
        <h2>Board</h2>
        {posts.length === 0 && <p className="empty">No posts yet.</p>}
        {posts.map((p) => (
          <article key={p.id} className={p.accepted ? "post ok" : "post rej"}>
            <div className="post-head">
              <span className="who">{p.accepted ? "verified member" : "not verified"}</span>
              <span className="reason">{p.reason}</span>
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
