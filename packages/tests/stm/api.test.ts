import { assert } from "../helpers.ts";

const API_PORT = 9999;

// Asserts the read API mirrors what the STM folded into the DB: posts (incl. an
// accepted one) and the anonymous badge minted by the operator-blind join.
export async function apiTest(acceptedAuthor: string, joinedBadge: string) {
  await assert("GET /api/posts returns the accepted post for the joined author", async () => {
    const res = await fetch(`http://localhost:${API_PORT}/api/posts`);
    if (!res.ok) return false;
    const data = await res.json();
    return (
      Array.isArray(data.posts) &&
      data.posts.some(
        (p: any) => p.author === acceptedAuthor && p.accepted === true,
      )
    );
  });

  await assert("GET /api/posts reports at least one rejected post", async () => {
    const res = await fetch(`http://localhost:${API_PORT}/api/posts`);
    const data = await res.json();
    // The stranger post is a real rejected row — proof the arbiter's check runs.
    return Number(data.rejected) >= 1;
  });

  await assert(`GET /api/badges returns the joined badge ${joinedBadge.slice(0, 8)}…`, async () => {
    const res = await fetch(`http://localhost:${API_PORT}/api/badges`);
    if (!res.ok) return false;
    const data = await res.json();
    return (
      Array.isArray(data.badges) &&
      data.badges.some((b: any) => b.pubkey === joinedBadge)
    );
  });
}
