# solana-anonboard — Contribution Readiness

Runs the project against the **Midnight Contribution Playbook**
(`nel349/midnight-contribution-playbook`) — the study of what the five maintainers
(JAlbertcode, nstanford5, Olanetsoft, gilescope, laurenelee) actually block on.

> **Status:** aliit-hub#170 was **approved by DevRel** (2026-08-14). The pre-approval
> eligibility hold is lifted; the deliverable phase is active. Submit path: **own public
> repo + link**. This doc tracks what's cleared and what's left before publishing.

## Scorecard

Legend: ✅ done · ⚠️ partial · ❌ open · ⬜ N/A

| # | Standard (Playbook) | Status | Notes |
|---|---|---|---|
| 1 | Deps aligned to the support matrix; no mixed generations | ✅ | midnight-js 4.1.1, ledger-v8 8.1.0, compact-runtime 0.16.0, onchain-runtime-v3 3.0.0. |
| 2 | Major-version ranges vs exact pins | ⚠️ | Exact-pinned (fine for a standalone repo; switch to `^` only if it ever lands as an example PR). |
| 3 | Use the barrels; don't over-declare | ⚠️ | Declares individual `midnight-js-*`; audit before any upstream PR. |
| 4 | **Verified/signed commits** | ❌ **blocker** | Commits still unsigned. Set up signing + re-sign before publishing (deferred per your call — local prep first). |
| 6 | Compiles / runs; they verify it | ✅ | Contract compiled; full loop browser-verified 2026-08-08. |
| 7 | Evidence: env/version table | ✅ | README now has a "Verified against" table. |
| 8 | Functional Compact code — no stubs | ✅ | Real `roster`/`badges`/`join`/nullifier logic. |
| 9 | Correct Compact visibility semantics | ✅ | `used` nullifier map not exported — the privacy design. |
| 10 | `pragma` correct + versions stated | ✅ | Verified against compiler 0.31.0 / language 0.23.0 — documented in README. |
| 11 | **README runnable, dependency-ordered** | ✅ | Rewritten for anonboard: idea → architecture → one-command quickstart → scope/limits. |
| 12 | Docs style guide | ✅ | Sentence-case, "smart contract"/"DApp"/"ZK", second person, no promo. |
| 13 | Real, public, open-source repo | ❌ | Local only — publish when ready. |
| 14 | `midnightntwrk` topic (+ `compact`) | ❌ | Set on publish. |
| 15 | **Exact attribution sentence** | ✅ | "This project is built on the Midnight Network." near the top of the README. |
| 16 | **LICENSE present** | ✅ | Apache-2.0 added, credits the upstream EffectStream template. |
| 17 | **Coherent project naming** | ✅ | Renamed to `solana-anonboard`; all packages under `@solana-anonboard/*`. |
| 18 | Conventional commits | ✅ | Clean `feat`/`chore`/`refactor` history. |
| 19 | Changelog with `PR:` link | ⚠️ | No CHANGELOG yet; add if going upstream. |
| 20 | Green, lean, SHA-pinned CI | ⬜ | No `.github/workflows` yet; add on publish (SHA-pin, `permissions: {}`). |
| — | Comment hygiene (example-repo bar) | ✅ | Superfluous/AI-slop comments cut; only load-bearing WHY kept. |

## Left before publishing

1. **Sign the commits** (#4) — the one hard blocker every maintainer enforces.
2. **Publish:** public repo + `midnightntwrk`/`compact` topics (#13–14).
3. **Then:** CI workflow (#20), CHANGELOG (#19).

## Open decisions (not blockers, your call)

- **`tests/` still exercises the counter suite**, not the membership/badge/post flow. An example should test its actual behavior — worth porting.
- **`counter.so` vs `.gitignore` contradiction:** `.gitignore` un-ignores it and says "committed on purpose," but it isn't tracked. Either commit the binary or drop the un-ignore + fix the comment (build-on-demand already works).
- **`scripts/read-state.ts`** hardcodes a one-run badge prefix — parameterize or drop.

---

*Source of every "standard": `nel349/midnight-contribution-playbook`. Assessed against the working tree at rename `solana-anonboard`.*
