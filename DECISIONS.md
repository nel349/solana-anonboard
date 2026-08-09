# Architecture decisions

Every non-obvious decision made for the PoC, with the reasoning and an honest
note on what deserves reconsideration for production. Each was chosen for the
best balance of correctness, security, simplicity, and cost at PoC scale.

---

## D1. Target network: localnet

**Decision:** build and demo on localnet (undeployed).

**Why:** it satisfies the acceptance criteria (compiles and runs on Midnight),
it is the fastest to demo, and it avoids the preview/mainnet cold-sync and dust
cost that add nothing to proving the concept.

**Reconsider for production:** on preview/mainnet the operator's Midnight wallet
cold-sync for dust can be heavy (the known cold-sync/heap issue). Before going
live, budget for that and pin the SDK to the current support matrix.

## D2. Membership secret is generated client-side; only the public key is registered

**Decision:** the member's browser generates the membership secret. It never
leaves the browser. Registration sends only the derived **public key** to the
admin, authorized by a one-time invite code. The admin adds that public key to
the roster.

**Why:** this is the secure best practice — the secret that proves membership is
never transmitted or stored server-side, so a compromised server or admin cannot
impersonate a member. The invite code authorizes *who may be added*; it is not
the membership secret. This cleanly separates the two.

**Rejected alternative:** admin pre-generates identities and ships the secret
inside the invite code (one step, simpler UX). Rejected because it puts the
membership secret on the wire and in the admin's hands, defeating the point.

**Reconsider:** the invite-code issuance channel is itself a trust boundary
(whoever issues codes controls membership). Fine and inherent; see D8.

## D3. Roster is an on-chain map (not a Merkle root), for the PoC

**Decision:** the roster is a `Map<Bytes<32>, Boolean>` in the contract; the join
circuit proves `roster.member(public_key(sk))`.

**Why:** simplest correct design, already proven, and fine for demo-scale
membership. Membership is genuinely proven in-circuit either way.

**Reconsider for scale:** each add is one transaction and the map grows on-chain,
and the sync re-reads the whole map each block (see D7). For large membership,
switch to a **Merkle-root roster**: publish one root, and have `join` prove a
Merkle path against it. That caps on-chain size and per-block read cost. Not
worth the extra circuit complexity at PoC scale.

## D4. The badge is a fresh, app-generated keypair on the public chain (no Phantom)

**Decision:** the badge is a fresh keypair generated in the browser; posting is
signed by it. The user's own wallet (e.g. Phantom) is never used to post.

**Why:** the badge must be unlinkable to the member. Posting through the user's
real wallet would tie every post to their public address and destroy the
anonymity the whole app exists for. A fresh session key is the correct choice.

**Reconsider:** none for the core loop. A "bring your own wallet" mode would be a
separate, explicitly non-anonymous feature with a clear warning; out of scope.

## D5. Both chains are gasless for the user; the operator funds two wallets

**Decision:** the operator runs one public-chain sponsor wallet (pays post fees)
and one Midnight wallet (pays dust for joins). Users hold nothing and pay
nothing. The batcher performs the operator-blind join and the gasless post.

**Why:** this is the walletless experience that makes the app more than a reskin,
and it is exactly what the PoC proved (operator-blind join, gasless post, author
balance unchanged). Posts write no account, so the only public-chain cost is a
per-post fee; joins are once-per-member.

**Reconsider:** rate-limiting and sponsor-wallet top-up monitoring for
production, so a spammer cannot drain the sponsor. See D8.

## D6. Proving happens client-side against a proof server (operator stays blind)

**Decision:** the join is proved in the browser via
`httpClientProofProvider(proofServerUri)`; the proved (unbalanced) transaction is
handed to the batcher, which balances, pays, and submits without ever seeing the
witness.

**Why:** this is what keeps the operator blind — the correct and load-bearing
privacy property. Verified in the PoC via the two-scope `blind-join` flow; the
browser variant uses the same proof provider over HTTP.

**Reconsider:** who hosts the proof server. On localnet it is the local one; in
production the operator hosts a proof server or the user's wallet provides one.
The proof server sees the witness during proving, so it must be in the user's
trust domain (local, or their own wallet's), not the operator's.

## D7. The sync reads the whole badge map each Midnight block

**Decision:** keep the straightforward full-map read for the PoC.

**Why:** correct and simple; negligible at demo scale.

**Reconsider for scale:** read badges incrementally (only new entries) rather than
re-parsing the entire map every block, once membership is large.

## D8. Trust model, stated honestly

**Decisions and their honest limits:**

- **Membership is proven, cryptographically, in-circuit.** Unforgeable; one badge
  per member via an unexported nullifier. Not a trust assumption.
- **Who-posted-what is hidden on-chain, absolutely.** The badge→member link is
  never recorded on either chain.
- **The roster gate is trusted.** Whoever issues invites / controls the roster
  decides who may be admitted. Inherent to any allowlist; the operator is trusted
  to choose the guest list, never to see who posted.
- **The one soft edge is off-chain request metadata.** The batcher sees that a
  request arrived (time/IP), so with few active users an observer running the
  batcher could *guess* a correlation from timing — never from chain data.
  Standard for any central submission point; mitigate with batching/delays/Tor if
  it matters. Do not claim "untraceable"; claim "unlinkable on-chain."

## D9. Message content lives in the public-chain log, bounded by tx size

**Decision:** the post body travels in the Solana instruction data (the log line
is the record); the UI enforces a max length.

**Why:** matches the "chain is the message bus" model; no account/rent needed.

**Reconsider:** the ~1232-byte transaction cap bounds a post to a few hundred
characters. For longer content, store the body off-chain (e.g. a blob) and put a
hash in the log. Out of scope for the PoC.

## D10. Session-key storage in the browser

**Decision:** store the membership secret and badge key in browser storage,
encrypted with a user passphrase (not plaintext).

**Why:** the keys must persist so a member can post across sessions, but plaintext
`localStorage` would expose them to any script. A passphrase-derived key is the
reasonable PoC balance.

**Reconsider:** for production, prefer non-extractable WebCrypto keys where the
signing scheme allows, a hardware/passkey-backed store, or delegating custody to
a wallet. Document the residual risk (XSS can still reach an unlocked key).

## D11. Ordering: optimistic pending, backfilled on badge sync

**Decision:** a post made before its badge has synced is shown as "pending" and
accepted automatically once the badge lands (the gap-D backfill).

**Why:** Midnight sync lags the fast chain, so a naive design would wrongly reject
a valid member's first post. Backfill makes it correct and the UI honest.

**Reconsider:** none; this is the correct handling and is already verified.
