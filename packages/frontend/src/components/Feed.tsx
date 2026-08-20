// The board: pending (optimistic) posts first, then the real feed with its accept/reject
// verdict. An optimistic row is hidden once its real row (same body + this badge) arrives.
import type { Post, Optimistic } from "../hooks/useFeed.ts";

export function Feed({
  posts,
  optimistic,
  badgePk,
}: {
  posts: Post[];
  optimistic: Optimistic[];
  badgePk: string;
}) {
  const pending = optimistic.filter(
    (o) => !posts.some((p) => p.body === o.body && p.author === badgePk),
  );
  return (
    <>
      <div className="board-head">
        <h2>Board</h2>
        <span className="line" />
      </div>

      <section className="feed">
        {posts.length === 0 && pending.length === 0 && <p className="empty">No posts yet.</p>}

        {pending.map((o) => (
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
    </>
  );
}
