// Collapse the two installed copies of Midnight's onchain runtime into one.
//
// Why this is needed:
//   @effectstream/sync depends on
//     "@midnight-ntwrk/onchain-runtime": "npm:@midnight-ntwrk/onchain-runtime-v3@3.0.0"
//   while @midnight-ntwrk/compact-runtime depends on
//     "@midnight-ntwrk/onchain-runtime-v3": "^3.0.0"
//
// Same package, same version, two names — so the installer writes two physical
// copies, which means two WASM instances and two distinct `StateValue` classes.
// The generated contract's `ledger()` does:
//
//   x instanceof __compactRuntime.StateValue ? x : x.state
//
// so a StateValue built by the sync fetcher (onchain-runtime) fails the
// instanceof against compact-runtime's class, falls through the ternary, and
// throws "expected instance of ChargedState" — with no hint about the real
// cause. Symlinking the alias to the real package gives one module instance
// and one class identity.
//
// The Midnight templates in the effectstream monorepo handle this inside
// link.sh; a standalone install has to do it itself.

import { existsSync, lstatSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname!, "..", "node_modules", "@midnight-ntwrk");
const alias = join(dir, "onchain-runtime");
const real = join(dir, "onchain-runtime-v3");

if (!existsSync(real)) {
  console.log("[dedupe-wasm] onchain-runtime-v3 not installed, nothing to do");
  process.exit(0);
}

if (existsSync(alias) && lstatSync(alias).isSymbolicLink()) {
  console.log("[dedupe-wasm] already deduped");
  process.exit(0);
}

rmSync(alias, { recursive: true, force: true });
symlinkSync("onchain-runtime-v3", alias);
console.log(
  "[dedupe-wasm] linked @midnight-ntwrk/onchain-runtime -> onchain-runtime-v3",
);
