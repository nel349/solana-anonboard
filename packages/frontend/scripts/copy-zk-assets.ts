// Copy the compiled ZK artifacts the browser needs to prove the `join` circuit
// into public/, where Vite serves them verbatim. The FetchZKConfigProvider
// (src/midnight/providers.ts) fetches them as raw bytes:
//   public/anonboard/keys/join.prover
//   public/anonboard/keys/join.verifier
//   public/anonboard/zkir/join.bzkir
// The proof server needs the EXACT bytes, so copy — never transform/compress.
//
// Run via `bun run copy-zk` (also wired as a predev/prebuild step by hand for
// now). Re-run after recompiling the contract.
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const MANAGED = path.resolve(
  import.meta.dirname!,
  "..",
  "..",
  "contracts-midnight",
  "contract-anonboard",
  "src",
  "managed",
);
const OUT = path.resolve(import.meta.dirname!, "..", "public", "anonboard");

// Only the `join` circuit is proved in the browser. add_to_roster is an
// owner/operator action and never runs client-side.
const ASSETS: Array<[string, string]> = [
  ["keys/join.prover", "keys/join.prover"],
  ["keys/join.verifier", "keys/join.verifier"],
  ["zkir/join.bzkir", "zkir/join.bzkir"],
];

mkdirSync(path.join(OUT, "keys"), { recursive: true });
mkdirSync(path.join(OUT, "zkir"), { recursive: true });

for (const [from, to] of ASSETS) {
  const src = path.join(MANAGED, from);
  const dst = path.join(OUT, to);
  copyFileSync(src, dst);
  console.log(`copied ${from} -> public/anonboard/${to}`);
}
console.log("zk assets copied.");
