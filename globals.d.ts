// Ambient module declarations for assets and untyped packages this repo uses.

// Bun text imports: `import sql from "./x.sql" with { type: "text" }`.
declare module "*.sql" {
  const content: string;
  export default content;
}

// Runtime-only packages that ship no types (used as launchers / build plugins).
declare module "@effectstream/solana-node";
declare module "vite-plugin-node-stdlib-browser";
