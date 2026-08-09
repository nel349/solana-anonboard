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

- [~] **In-browser proving of the join:** the join must be proved client-side,
      which needs a proof server (URL). Verified in Node, not yet in a browser;
      zswap-da is the precedent that browser proving of a contract call works.
      This is the single biggest frontend unknown — spike it first.
- [ ] Live feed (read, no wallet) over REST + MQTT.
- [ ] Join flow: invite → generate identity → operator-blind join → "verified,"
      with the pending-until-synced state shown honestly.
- [ ] Post flow: type → gasless submit → optimistic pending → confirmed.
- [ ] Identity panel: verified-member status, badge backup/export.
- [~] **Session-key storage:** the membership secret and badge key live in the
      browser. Decide the storage/encryption model (not plaintext localStorage).

## F. Packaging / infra (from INVESTIGATION.md)

- [x] WASM runtime dedupe (bug #1) — postinstall.
- [x] Hoisted `node_modules` path fixes (bug #2).
- [x] `launchMidnight` export path + storage password (bug #3).
- [~] **Validator ledger retention (bug #4):** configure retention / start the
      sync near tip so a long-running node does not wedge on pruned blocks.
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

- [ ] Browser proof of the `join` circuit end to end (the item 1 spike).
- [ ] Confirm the target network (localnet demo vs preview live) — it decides
      whether D/C scale items are in scope.
- [ ] Choose the registration model and roster representation (map vs Merkle).

## Review

(to be filled in as items close)
