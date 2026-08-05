# Claim comment for aliit-hub#170

Paste the block below as a comment on
https://github.com/midnightntwrk/aliit-hub/issues/170

Check first whether DevRel wants the idea validated before the `/claim` comment
or as part of it. The task text implies validation comes first.

---

```
/claim

I already have a working proof of concept and want to develop it into the
submission. It is an anonymous message board where every post is provably from
a group member, but no post can be traced back to a person. Membership is
proven once on Midnight by a Compact circuit that checks a roster and burns a
nullifier, so each member gets exactly one anonymous badge, and that badge is
just a fresh Solana keypair. All posting happens on Solana. The EffectStream
state machine is where the two chains actually meet: it reads the badge set
from Midnight's public ledger, reads posts from the Solana program log, and
counts a post only if its signer holds a badge. That check is the whole point.
In the running PoC, a post from the badge holder is recorded accepted:true and
a post from a key that never joined is accepted:false, from the same program in
the same moment. The nullifier map is deliberately not exported, so the sync
node cannot read it and joins cannot be counted or correlated. The existing
Midnight templates correlate their chains in Postgres, and zk-cardano states
outright that its eligibility is not enforced in the circuit. Here it is.
Building this also surfaced a packaging bug I would report upstream:
@effectstream/sync aliases onchain-runtime to onchain-runtime-v3 while
compact-runtime depends on the real name, so a standalone install gets two WASM
instances and every contract ledger() read fails with a misleading ChargedState
error. The Midnight templates hide this inside link.sh, but a standalone repo,
which this task requires, has no such help. I plan to reuse the Solana leg from
solana-starter, the browser proving path from zswap-da so the batcher never
sees private inputs, and the identity pattern from example-bboard, with the
roster gate, the one-badge-per-person nullifier, and the cross-chain arbiter as
the new work. I could not find an existing Solana plus Midnight template, so
this would also be the first pairing of those two chains.
```

---

## Notes on the choices

**Opens with the PoC.** A claim that describes a plan competes with every other
claim. One that reports a result does not.

**Evidence is concrete.** `accepted:true` / `accepted:false`, same program, same
moment. No adjectives.

**The upstream bug is deliberate.** Three sentences, and it buys a lot: it shows
the work is real, it is genuinely useful to the EffectStream team, and it
pre-empts anyone assuming a standalone build just works.

**Lineage volunteered up front**, with the new work named right after it. That
is the sentence a reviewer checking the "not a reskin" bar looks for.

**Left out on purpose:** the ordering bug (posts judged before badges finish
syncing) belongs in the first check-in, not the claim, where it would read as an
unresolved risk rather than a solved one.

**Hedged on purpose:** "I could not find an existing Solana plus Midnight
template" rather than asserting it, because a maintainer could correct that in
one reply. It was verified by grepping every `templates/*/packages/node/
config.dev.ts` for Midnight, which turns up EVM, Bitcoin and Cardano only.

## Open before posting

- The roster source is generic in this draft. DevRel may have a view on whether
  it should be Aliit membership, a Discord role, or a plain uploaded list.
