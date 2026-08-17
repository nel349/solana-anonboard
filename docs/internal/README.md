# solana-anonboard — internal docs

> **Internal only.** Lasting reference notes + the design system for the anonboard
> PoC (Midnight × Solana). Kept in the private repo; excluded from the public
> example (see the root `.gitignore`). Point-in-time working docs (delivery plan,
> submission drafts, investigation logs) were removed once obsolete — the git log
> is the record of how it was built.

## Understand it
- **[SYSTEM.md](./SYSTEM.md)** — the whole system story: what anonboard does on
  both chains, the flow, the important parts, the file map. **Read this first.**
- **[LOCALNET-DESIGN.md](./LOCALNET-DESIGN.md)** — the localnet self-host/attach
  design, what shipped, and the arm64 cold-boot gotchas. Referenced from
  `localnet-preflight.ts` / `scripts/restart-on-failure.ts`.

## Design system
- **[design/DESIGN-SYSTEM.md](./design/DESIGN-SYSTEM.md)** — the visual language:
  tokens, type, the claw-reveal motif, components. Live references:
  `design/claw-solana.html` (canonical hero), `design/design-system.html` (showcase).
