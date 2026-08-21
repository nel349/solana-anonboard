// Guard against the "b.writeBigUInt64LE is not a function" class of bug: the browser's Buffer
// polyfill lacks the BigInt read/write methods, so the client code the frontend bundles must not
// use them (use u64.ts's hand-rolled codec instead). This fails if any browser-reachable client
// file reintroduces one — a static check that runs long before a user hits it in the browser.
import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const HERE = import.meta.dirname!;
// Files pulled into the frontend bundle via the barrel. post-account.ts is reader-only (Node)
// and is intentionally excluded — it is never imported by the browser.
const BROWSER_FILES = ["instructions.ts", "program-id.ts", "dev-config.ts", "u64.ts", "mod.ts"];
const FORBIDDEN = /\.(read|write)Big(U?[Ii]nt)64(LE|BE)?\(/;

function stripComments(src: string): string {
  return src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("browser-safety: no Node-only Buffer BigInt methods in bundled client code", () => {
  for (const f of BROWSER_FILES) {
    it(`${f} avoids read/writeBig*64 (use u64.ts)`, () => {
      const code = stripComments(readFileSync(path.join(HERE, f), "utf8"));
      expect(FORBIDDEN.test(code)).toBe(false);
    });
  }
});
