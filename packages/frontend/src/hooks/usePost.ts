// Fire-and-forget posting: the post shows optimistically and the board reflects the
// accept/reject verdict when it lands, so the composer never locks on the receipt.
import { useEffect, useState } from "react";
import type { Keypair } from "@solana/web3.js";
import { submitPost } from "../solana/post.ts";
import type { Optimistic } from "./useFeed.ts";
import type { SetStatus } from "./useAppStatus.ts";

export type Composer = {
  draft: string;
  setDraft: (v: string) => void;
  post: () => void;
  // True only while the submit is in flight (until the batcher returns the receipt), so
  // the Post button can show "Posting…" without locking on the on-chain confirmation.
  posting: boolean;
};

export function usePost(opts: {
  badge: Keypair;
  optimistic: Optimistic[];
  addOptimistic: (body: string) => number;
  dropOptimistic: (ts: number) => void;
  setStatus: SetStatus;
}): Composer {
  const { badge, optimistic, addOptimistic, dropOptimistic, setStatus } = opts;
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  // ts of the post we're confirming, so we can clear "confirming…" once it lands.
  const [pendingTs, setPendingTs] = useState<number | null>(null);

  useEffect(() => {
    if (pendingTs !== null && !optimistic.some((o) => o.ts === pendingTs)) {
      setPendingTs(null);
      setStatus((s) => (s.msg.startsWith("Posted") ? { msg: "", kind: "info" } : s));
    }
  }, [optimistic, pendingTs, setStatus]);

  function post(): void {
    const body = draft.trim();
    if (!body) return;
    const ts = addOptimistic(body);
    setPendingTs(ts);
    setDraft("");
    setPosting(true);
    setStatus({ msg: "Posting…", kind: "info" });
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
      })
      .finally(() => setPosting(false));
  }

  return { draft, setDraft, post, posting };
}
