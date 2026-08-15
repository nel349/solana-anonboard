# solana-anonboard — internal docs

> **Internal only.** Working notes, design system, and submission drafts for the
> anonboard PoC (Midnight × Solana, aliit-hub #170). Not part of the public
> example — do not include this folder when the example repo is published.

Start here, then branch by what you need:

## Understand it
- **[SYSTEM.md](./SYSTEM.md)** — the whole system story: what anonboard does on
  both chains, the flow, the important parts, the file map. **Read this first.**
- **[design/DESIGN-SYSTEM.md](./design/DESIGN-SYSTEM.md)** — the visual language:
  tokens, type, the claw-reveal motif, components, and how to apply it to the
  frontend. Live references: `design/claw-solana.html` (canonical hero),
  `design/design-system.html` (showcase).

## Ship it
- **[DELIVERY-PLAN.md](./DELIVERY-PLAN.md)** — the checklist of what must be done
  before delivering to DevRel. **The to-do list.**
- **[orchestration.md](./orchestration.md)** — how `bun run dev` / the tests boot
  the stack, why it currently collides with an existing localnet, and the seam to
  attach to one instead.

## Status & submission
- **[RESULT.md](./RESULT.md)** — the end-to-end verification log (what was proven working).
- **[submission/READINESS.md](./submission/READINESS.md)** — scorecard vs the
  maintainer contribution standards.
- **[submission/CLAIM.md](./submission/CLAIM.md)** · **[submission/DEVREL-PROPOSAL.md](./submission/DEVREL-PROPOSAL.md)** — the bounty claim + proposal drafts.

## Background (history)
- **[INVESTIGATION.md](./INVESTIGATION.md)** · **[IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md)** · **[DECISIONS.md](./DECISIONS.md)** — how we got here.
