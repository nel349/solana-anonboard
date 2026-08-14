import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import nodePolyfills from "vite-plugin-node-stdlib-browser";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

// One copy of each Midnight WASM module (dedupe + optimizeDeps.exclude): two copies = two
// StateValue classes → the ledger read throws "expected instance of ChargedState".
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
