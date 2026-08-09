# Technical concept checklist

Concepts and goals for the anonymous board (Solana + Midnight), grouped by area.
Status per item: [x] verified in the PoC · [~] needs investigation · [ ] open
decision or not started. No implementation detail here — concepts only.

This checklist extends `IMPLEMENTATION-PLAN.md`. Items marked [~]/[ ] are the
gaps that plan under-specified; they are called out in "Newly surfaced gaps."

---

## A. Private membership (Midnight)

- [x] Membership is proven in-circuit (roster set-membership + knowledge of the
      secret), not in a database.
- [x] One badge per member, enforced by an unexported nullifier.
- [x] The badge (a public key on the public chain) is the only thing disclosed;
      no link to the member is recorded on-chain.
- [ ] **Registration handshake:** how a member's public key gets onto the roster.
      Two models to choose: (1) member generates the secret, sends the public key
      to the admin with an invite; (2) admin pre-issues the identity and the
      invite carries the secret. Pick one.
- [~] **Roster at scale:** today the roster is an on-chain map, one add per tx.
      Fine for a demo; for large membership consider a Merkle-root roster (prove
      a path against one published root). Decide whether the submission needs it.
- [ ] **Key recovery / rotation:** losing the badge key or membership secret
      currently locks a member out permanently (nullifier spent). Decide the
      recovery story, even if it is "re-invite with a new roster entry" for v1.

## B. Public action (Solana)

- [x] Real `post(body)` program; the log line is the record; no account written.
- [x] The author signs for free; the fee-payer is separate.
- [~] **Message size limit:** the body travels in Solana instruction data under
      the ~1232-byte transaction cap, so posts are bounded to a few hundred
      characters. The UI must enforce a max length.
- [ ] Content policy: the arbiter accepts any badge-holder's post. Decide whether
      any moderation/limits are in scope (likely out of scope for v1).

## C. The cross-chain link (EffectStream state machine)

- [x] Arbiter: a post is counted only if its signer holds a badge read from
      Midnight's ledger.
- [x] Ordering backfill: a post that lands before its badge syncs is held, then
      accepted when the badge arrives (gap D).
- [x] Deterministic + replay-safe (idempotent upserts; badge-map read is pure).
- [~] **Badge-set read cost:** the sync re-parses the whole badge/roster map each
      Midnight block. Fine at small scale; confirm it is acceptable at the target
      size, or read incrementally.

## D. Walletless UX and funding

- [x] Operator-blind join: a funded party pays + submits a locally-proven join
      and never sees the membership secret.
- [x] Gasless post: author holds zero tokens; the sponsor pays.
- [x] Funding model: operator runs one Solana sponsor wallet + one Midnight
      fee-payer wallet; users pay nothing.
- [ ] No Phantom (would de-anonymize); Lace optional, not required. Confirm this
      is the accepted UX with DevRel.
- [~] **Operator wallet on a real network:** on preview/mainnet the operator's
      Midnight wallet cold-sync for dust can be heavy (the known cold-sync/heap
      issue). Localnet is unaffected. Confirm the target network first.

## E. Frontend

- [x] **In-browser proving of the join:** the join is proved client-side against
      the proof server. Verified end to end in a real browser (the spike produced
      a valid unbound join tx from a fresh browser session). This was the single
      biggest frontend unknown; it is now de-risked.
- [x] Live feed (read, no wallet) over REST — the board polls /api/posts and
      /api/badges; no wallet needed to read. (MQTT not wired; REST suffices.)
- [x] Join flow: generate identity → in-browser proof → operator submits →
      member, with the pending-until-synced state shown honestly. Verified end to
      end in the browser (badge flips not-a-member → member after the sync
      mirrors it). Registration is operator-enrolled for the demo; invite-gated
      registration is the remaining productization step.
- [x] Post flow: type → gasless submit → shows member once the arbiter counts it.
- [x] Identity panel: member status + sponsor balance + real per-post cost.
      (Badge backup/export still open.)
- [~] **Session-key storage:** the membership secret and badge key live in the
      browser. Decide the storage/encryption model (not plaintext localStorage).

## F. Packaging / infra (from INVESTIGATION.md)

- [x] WASM runtime dedupe (bug #1) — postinstall.
- [x] Hoisted `node_modules` path fixes (bug #2).
- [x] **Migration-vs-block-processing boot race (bug #5):** our app migrations
      (posts/badges) carry no `blockHeight`, so the framework
      (`@effectstream/db` getMigrationsForBlockHeight, `blockHeight ?? 1`) applies
      them only when the sync PROCESSES main block 1 — during block processing.
      On boot the Solana leg catches up a burst of slots before block 1 is
      assembled, and a query against posts/badges in that window rejects (42P01)
      and kills the critical sync. Fix: `main.dev.ts` ensures the schema up front
      (idempotent CREATE TABLE IF NOT EXISTS) before `start()` processes blocks,
      so the tables exist before anything reads them; the block-1 user migration
      is then a no-op.
- [x] `launchMidnight` export path + storage password (bug #3).
- [~] **Validator ledger retention (bug #4):** root cause confirmed (after
      ~45 min the validator prunes blocks the Solana sync still needs → the sync
      wedges). A direct-spawn launcher with a large `--limit-ledger-size` fixes
      the stall BUT shifts boot timing enough to race the DB migrations (sync
      crashes on "relation posts does not exist"). Durable fix: add a
      `--limit-ledger-size` passthrough to the vendored `run()` upstream so
      retention is raised WITHOUT changing launch timing. Reverted the
      direct-spawn for now; the stall only bites after ~45 min, so a fresh boot
      demos fine. Follow-up.
- [ ] Real project README with a step-by-step run tutorial (acceptance criterion;
      the current README is still the stock template).
- [ ] Awesome dApps metadata: `midnightntwrk` GitHub topic + attribution
      sentence, then the listing PR.

---

## Newly surfaced gaps (not in the original plan)

Ranked by how much they could change the design:

1. **In-browser join proving + proof-server dependency (E).** Highest. Spike a
   browser proof of the join before committing the frontend design.
2. **Registration handshake (A).** How public keys reach the roster — pick a
   model; it shapes the join UX.
3. **Roster scale: map vs Merkle root (A).** Only matters if membership is large;
   decide per the submission's intended scale.
4. **Key recovery / rotation (A).** Needed for real use; can be minimal for v1
   but must be stated.
5. **Operator cold-sync on preview (D)** and **badge-map read cost (C)** — both
   only bite beyond localnet / small scale; confirm the target.
6. **Message size limit (B)** and **session-key storage (E)** — small but real;
   decide the bounds.

## Investigate next (spikes, before building the deliverable)

- [x] Browser proof of the `join` circuit end to end (the item 1 spike). Done —
      proved in-browser, valid unbound tx produced.
- [ ] Confirm the target network (localnet demo vs preview live) — it decides
      whether D/C scale items are in scope.
- [ ] Choose the registration model and roster representation (map vs Merkle).

## Review

(to be filled in as items close)
