// Pure helpers for the indexer proxy, extracted so they're unit-testable without
// starting the server that indexer-proxy.ts binds on import.

// A GraphQL POST is coalescable only if it is a read — never fold two mutations into
// one upstream call. A standalone `mutation` keyword (word-boundary match) marks a
// mutation and gets its own request; reads (and identifiers that merely embed the word,
// like `mutationLog`) coalesce. Returns the coalescing key, or null (don't coalesce).
export function coalesceKey(bodyText: string): string | null {
  try {
    const parsed = JSON.parse(bodyText) as { query?: unknown };
    const q = typeof parsed.query === "string" ? parsed.query : "";
    if (!q || /\bmutation\b/.test(q)) return null;
    return bodyText;
  } catch {
    return null;
  }
}

// The body is already decoded into bytes, so echoing the upstream's content-encoding /
// length would make the client try to gunzip plain bytes. Strip those (and hop-by-hop).
const STRIP_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "upgrade",
]);

export function filterResponseHeaders(entries: [string, string][]): Headers {
  const headers = new Headers();
  for (const [k, v] of entries) {
    if (!STRIP_RESPONSE_HEADERS.has(k.toLowerCase())) headers.set(k, v);
  }
  return headers;
}
