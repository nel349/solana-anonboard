import { describe, test, expect } from "bun:test";
import { coalesceKey, filterResponseHeaders } from "./indexer-proxy-lib.ts";

describe("coalesceKey (query-only coalescing)", () => {
  test("a read query coalesces on its exact body", () => {
    const body = JSON.stringify({ query: "{ block { height } }" });
    expect(coalesceKey(body)).toBe(body);
  });

  test("a mutation is NEVER coalesced (would fold two writes into one)", () => {
    expect(coalesceKey(JSON.stringify({ query: "mutation { connect(x: 1) }" }))).toBeNull();
    expect(coalesceKey(JSON.stringify({ query: "  mutation Foo { doThing }" }))).toBeNull();
  });

  test("a read whose name embeds 'mutation' is still coalesced (word-boundary match, not substring)", () => {
    const body = JSON.stringify({ query: "query mutationLog { x }" });
    expect(coalesceKey(body)).toBe(body);
  });

  test("a mutation with no space before the brace is still caught", () => {
    expect(coalesceKey(JSON.stringify({ query: "mutation{ addBadge }" }))).toBeNull();
  });

  test("missing/empty query or malformed JSON → no coalescing", () => {
    expect(coalesceKey(JSON.stringify({ query: "" }))).toBeNull();
    expect(coalesceKey(JSON.stringify({ notaquery: "x" }))).toBeNull();
    expect(coalesceKey("{ not json")).toBeNull();
    expect(coalesceKey("")).toBeNull();
  });

  test("two identical read bodies produce the same key (so they share one upstream call)", () => {
    const a = JSON.stringify({ query: "{ a }" });
    const b = JSON.stringify({ query: "{ a }" });
    expect(coalesceKey(a)).toBe(coalesceKey(b)!);
  });
});

describe("filterResponseHeaders", () => {
  test("strips encoding/length/hop-by-hop headers that would corrupt the already-decoded body", () => {
    const h = filterResponseHeaders([
      ["Content-Encoding", "gzip"],
      ["Content-Length", "123"],
      ["Transfer-Encoding", "chunked"],
      ["Connection", "keep-alive"],
      ["Content-Type", "application/json"],
    ]);
    expect(h.get("content-encoding")).toBeNull();
    expect(h.get("content-length")).toBeNull();
    expect(h.get("transfer-encoding")).toBeNull();
    expect(h.get("connection")).toBeNull();
    expect(h.get("content-type")).toBe("application/json");
  });

  test("is case-insensitive on the strip list", () => {
    expect(filterResponseHeaders([["CONTENT-ENCODING", "br"]]).get("content-encoding")).toBeNull();
  });
});
