// Copy the join circuit's ZK artifacts into public/ for Vite to serve.
// The proof server needs the EXACT bytes, so copy — never transform/compress.
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

// Only join is proved client-side; add_to_roster is operator-only.
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
