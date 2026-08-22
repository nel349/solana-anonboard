// Feed + membership, polled every 500ms. Optimistic rows live here too: add one on
// post, and each is dropped once its real row (same body + badge) arrives.
import { useCallback, useEffect, useState } from "react";
import { BADGES_URL, POSTS_URL } from "../config.ts";

export type Post = {
  id: number;
  author: string;
  body: string;
  accepted: boolean;
  reason: string;
};
export type Optimistic = { body: string; ts: number };

export function useFeed(badgePk: string) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [isMember, setIsMember] = useState<boolean | null>(null);
  const [optimistic, setOptimistic] = useState<Optimistic[]>([]);

  const addOptimistic = useCallback((body: string): number => {
    const ts = Date.now();
    setOptimistic((prev) => [{ body, ts }, ...prev]);
    return ts;
  }, []);
  const dropOptimistic = useCallback((ts: number): void => {
    setOptimistic((prev) => prev.filter((o) => o.ts !== ts));
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const [pRes, bRes] = await Promise.all([fetch(POSTS_URL), fetch(BADGES_URL)]);
        // On a backend error keep the last-known feed/membership rather than
        // flipping the board to empty and the badge to "not a member".
        if (!pRes.ok || !bRes.ok) {
          console.error(
            `[anonboard] feed fetch failed (posts ${pRes.status}, badges ${bRes.status}); keeping last state`,
          );
          return;
        }
        const pJson = await pRes.json();
        const bJson = await bRes.json();
        if (!alive) return;
        const realPosts: Post[] = pJson.posts ?? [];
        setPosts(realPosts);
        setIsMember((bJson.badges ?? []).some((b: { pubkey: string }) => b.pubkey === badgePk));
        setOptimistic((prev) =>
          prev.filter((o) => !realPosts.some((p) => p.body === o.body && p.author === badgePk)),
        );
      } catch (e) {
        // Transient network error — keep last state, surface for debugging.
        console.error("[anonboard] feed poll error:", e);
      }
    };
    tick();
    // Poll every 500ms so the board reflects the sub-second sync quickly. A
    // production build could subscribe to the sync's MQTT push instead of polling.
    const h = setInterval(tick, 500);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, [badgePk]);

  return { posts, isMember, optimistic, addOptimistic, dropOptimistic };
}
