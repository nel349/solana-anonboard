# solana-anonboard — Delivery Plan

> **Historical (2026-08-15 snapshot).** Many items below are done — the
> counter→anonboard rename, attach/self-host refactor, ported tests, NOTICE, dist
> ignore, poster.json untracking, the Merkle anonymity fix, and the code-review
> follow-ups (silent-failure handling, insertPost idempotency, preflight compat
> gate, dead-code removal, tsconfig/CI). Treat this as a point-in-time plan; the
> git log is the source of truth.

Internal. The checklist to get the repo **perfect before delivering to DevRel**.
Based on a full-repo audit (code/build health + delivery/hygiene), 2026-08-15.

**Bottom line:** the mechanics are solid and match `SYSTEM.md` — no bugs, no
TODOs, the Compact contract and arbiter are correct. The polish gap is almost
entirely the **unfinished rename from the `solana-starter` counter template**:
dead counter code is scattered across the Rust program, the DB, the node API, and
the Solana TS bindings. Clean that up, fix a committed key + signing, get the
tests green, and it's a clean, professional example.

Work top-down. Check items off in place.

---

## ✅ Done so far (2026-08-15) — pushed to private `nel349/solana-anonboard`

- **Counter cleanup** (`f4b49b2`) — removed all dead template code: Rust program
  trimmed to Post (250→56 lines), dead node API endpoints, counter DB tables +
  query layer, increment/reset TS builders; renamed `COUNTER_PROGRAM_ID` →
  `POST_PROGRAM_ID`; parameterized the read-state.ts hardcode. Verified: bun
  install, transpile, `bun run build:solana` (same program id).
- **Repo hygiene** (`afd730d`) — package.json metadata; documented the committed
  dev keypairs (batcher + program); fixed the anonboard.so gitignore contradiction
  (build-on-demand); untracked the built frontend `dist/`; reworded stale comments.
- **Publish** — docs relocated to `docs/internal/` + made tracked; `poster.json`
  (a committed keypair) untracked; repo pushed **private** with full history.

## ⏳ Remaining

- **P0:** sign the commits (needs your key) · attach refactor + tests green
  (needs a localnet; coordinate ports).
- **Deferred:** rename the `programs/anonboard` dir/crate (couples to `.so` + keypair).
- **Open decisions:** wire the design system into the frontend · scrub history
  before any public release · CI · workspace-version alignment.

---

## P0 — Blockers (must be done before delivery)

- [ ] **Remove the committed private key.** `poster.json` (root) is a tracked
      64-byte Solana secret key. `git rm --cached poster.json` (it's already in
      `.gitignore`; file stays on disk).
- [ ] **Sign the commits.** Every commit is unsigned; maintainers hard-block on
      verified signatures. Set up GPG/SSH signing and re-sign the history.
- [ ] **Get the integration tests green.** The suite is written and correct but
      can't run while a localnet is up (the test launcher self-boots Midnight on
      9944/8088/6300 and kills it). Do the **attach refactor** (below), then run
      `bun run test` to green and commit it.
- [ ] **Attach-to-existing-localnet refactor.** In `start.dev.ts` /
      `packages/tests/start.test.ts`, drop the three self-boot Midnight processes,
      keep the `midnight-contract` deploy, fund the deploy wallet on the target
      chain. (Full recipe in `orchestration.md` → "The seam.") Unblocks the tests.

## P1 — Finish the rename (counter → anonboard) — the bulk of "perfect"

An external reviewer opening "the Solana program" or the DB currently sees mostly
counter code. Remove the dead template code:

- [ ] **Rust program** — trim `contracts-solana/programs/anonboard/src/lib.rs` to
      the `Post` path; delete Increment/Reset/PDA/`EFFECTSTREAM_COUNTER` logic.
- [ ] **Node API** — delete the dead endpoints in `node/api.ts`:
      `/api/counter/:authority`, `/api/counters`, `/api/counter-events`.
- [ ] **DB layer** — delete the counter tables (`database/migrations/000-init.sql`
      `counter_state`/`counter_events`) and the counter queries
      (`database/sql/queries.sql` + generated `queries.queries.ts`). Real queries
      live in `database/sql/anonboard.ts`.
- [ ] **Solana TS bindings** — drop the unused `createIncrementInstruction` /
      `createResetInstruction` / `findCounterAddress` / `counterKeys`
      (`contracts-solana/instructions.ts`) and `COUNTER_SEED` /
      `DISCRIMINANT_INCREMENT|RESET` (`program-id.ts`).
- [ ] **Rename the identifier** `COUNTER_PROGRAM_ID` → `POST_PROGRAM_ID` (used in
      `node/config.dev.ts`, `node/state-machine.ts`); drop the unused re-export at
      `config.dev.ts` bottom.
- [ ] **Rename the program dir** `programs/anonboard/` → `programs/anonboard/`, and
      the `build-anonboard` process / `anonboard.so` refs (`start.dev.ts`,
      `start.test.ts`, `run-tests.ts`).
- [ ] **Remove scratch value** — `scripts/read-state.ts:17` hardcodes a one-run
      badge prefix `"81itZYcw"`. Parameterize or delete the helper.

## P1 — Hygiene

- [ ] **Resolve `anonboard.so` vs `.gitignore`.** `packages/contracts-solana/.gitignore`
      un-ignores `/build/anonboard.so` and says "committed on purpose," but no `.so`
      is tracked. Decide: commit the binary, **or** drop the un-ignore + fix the
      comment (build-on-demand already works). Recommend the latter for a clean example.
- [ ] **Document the batcher fee-payer key.** `packages/batcher/keypair/batcher-wallet.json`
      is a committed secret with no ignore rationale. Add a `keypair/*` +
      `!batcher-wallet.json` ignore block (mirror contracts-solana) and a line in
      README "Scope and limitations" that it's a dev-only, publicly-known key —
      never fund it on a live net. (`counter-program.json` is already documented — leave it.)
- [ ] **Root `package.json` metadata** — add `description`, `repository`, and
      `license: "Apache-2.0"` (to match the LICENSE file).
- [ ] **Gitignore the built frontend** — `packages/frontend/dist/` is tracked and
      goes stale; ignore it unless it's deliberately served.
- [ ] **Clean the working tree before packaging** — `*.log` (batcher-debug/bj/boot/
      gp/joinbrowser), `.DS_Store`, `batcher-data/`, `*/.midnight-data/`,
      `midnight-level-db-deploy/`. (All gitignored, so a clean `git clone` is fine;
      matters only if zipping the tree.)

## P2 — Nice-to-have

- [ ] **Minimal CI** — a SHA-pinned GitHub Action with `permissions: {}` that runs
      `bun install`, the Compact compile, `bun run build:solana`, and `bun test`.
      (Do after the tests are green.)
- [ ] **Reword stale comments** — `tests/stm/post.test.ts:1` ("Phantom" → Midnight
      wallets Lace/1AM); `tests/stm/api.test.ts:23` ("counter" → "rejected row").
- [ ] **Fresh-clone note** — `App.tsx` imports the generated
      `contract-anonboard.undeployed.json`; a bare `vite build` fails before a
      deploy. Add a README note or a committed stub.
- [ ] **Align workspace versions** (mix of 1.0.0 / 0.1.0) + add `private: true` to
      `database`, `contracts-midnight`, `contract-anonboard`.
- [ ] **NOTICE file** — Apache-2.0 courtesy attribution for the upstream template.
- [ ] Optional: add a `tsconfig.json` + typecheck script (today there's no type gate).

## Publish & history (process)

- [ ] **Commit the docs relocation** — the `docs/ → docs/internal/` move is still
      uncommitted (old paths show as deletions). Commit it.
- [ ] **Make `docs/internal/` trackable** — remove the `docs/internal/` line from
      `.gitignore` so the reference travels with the repo.
- [ ] **Publish to a PRIVATE GitHub repo** (nel349) for remote reading/tracking.
      Private is safe for the internal drafts.
- [ ] ⚠️ **Before the repo ever goes PUBLIC: scrub history.** The internal
      submission drafts (CLAIM.md, DEVREL-PROPOSAL.md, …) are recoverable from
      history (introduced in `85740c6`), and `docs/internal/` shouldn't ship
      publicly at all. Plan: a fresh `git init` (clean history from commit 1) with
      `docs/internal/` excluded, or a separate public repo. **Decide this before
      any public push, not after.**

## Open decisions (yours to make — not blockers)

- [ ] **Design system wiring.** The full theme (`docs/internal/design/`) is NOT in
      the frontend yet — `frontend/src/index.css` uses a small inline palette. Do
      we wire the claw-reveal hero + tokens + components into `packages/frontend`
      before delivery, or ship the working (plain) UI now and theme it next? This
      is the one large remaining workstream.
- [ ] **Futura font.** If we wire the theme, embed Futura (licensed) or an open
      substitute (Jost) as a self-hosted `@font-face` so it renders off-Mac.
- [ ] **Public vs private strategy.** Deliver privately for DevRel review first,
      then prep the clean public example — or go straight to a clean public repo.
