import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import nodePolyfills from "vite-plugin-node-stdlib-browser";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

// The frontend proves a Midnight Compact circuit (the `join`) in the browser.
// That pulls in the Midnight WASM runtime (compact-runtime / onchain-runtime-v3
// / ledger-v8), which needs:
//   - vite-plugin-wasm + top-level-await: load the .wasm modules ESM-style.
//   - node stdlib polyfills + Buffer/global: the SDK assumes Node globals.
//   - resolve.dedupe + optimizeDeps.exclude: force ONE copy of each WASM module.
//     Two copies means two `StateValue` classes and the ledger read throws
//     "expected instance of ChargedState" (the same dup bug fixed at the Node
//     layer via the postinstall symlink). Excluding them from esbuild's
//     pre-bundle keeps a single instance.
const MIDNIGHT_WASM = [
  "@midnight-ntwrk/onchain-runtime-v3",
  "@midnight-ntwrk/compact-runtime",
  "@midnight-ntwrk/ledger-v8",
  "@midnight-ntwrk/compact-js",
];

export default defineConfig({
  plugins: [wasm(), topLevelAwait(), react(), nodePolyfills()],
  define: {
    global: "globalThis",
  },
  resolve: {
    dedupe: MIDNIGHT_WASM,
  },
  optimizeDeps: {
    exclude: MIDNIGHT_WASM,
    // Excluding the WASM packages also skips esbuild's CJS->ESM interop for
    // their CommonJS transitive deps, so a bare `import x from 'object-inspect'`
    // fails with "does not provide an export named 'default'". Force-include the
    // CJS deps that need converting.
    include: ["object-inspect"],
  },
  server: {
    // The contract package (packages/contracts-midnight) has empty `exports`, so
    // the frontend imports its compiled contract + witnesses by relative path
    // (as scripts/blind-join.ts does). Allow Vite to serve from the monorepo root.
    fs: { allow: [".."] },
  },
});
