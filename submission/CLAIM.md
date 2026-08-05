# Claim comment for aliit-hub#170

Paste the **Primary version** below as a comment on
https://github.com/midnightntwrk/aliit-hub/issues/170

Check first whether DevRel wants the idea validated before the `/claim` comment
or as part of it. The task text implies validation comes first.

---

## Primary version

```
/claim

I want to build a different version of the Midnight bulletin board, and I have
a working proof of concept already running.

example-bboard shows that a board can hide who posted: it records a commitment
so the poster can later prove the post was theirs, without the chain knowing who
they are. What it does not do is answer the second question every real board
needs, which is whether this person is allowed to post at all. It has no notion
of membership, so any wallet can post; it holds one message at a time; and the
message itself lives on Midnight.

My version answers both questions at once, and splits the work across two chains
according to what each is good at. Membership is proven once on Midnight by a
Compact circuit that checks a roster and burns a nullifier, so each member gets
exactly one anonymous badge, and that badge is simply a fresh Solana keypair.
Posting then happens entirely on Solana, where it is fast and cheap. Midnight
holds only the right to speak; the speech itself lives on the chain built for
volume. The EffectStream state machine is where the two chains meet: it reads
the badge set from Midnight's public ledger, reads posts from the Solana program
log, and counts a post only if its signer holds a badge. That check is the whole
point. The result is a board where every post is provably from a real member and
no post can be traced back to a person, including by whoever runs the servers.

This is the part the existing templates stop short of. All three Midnight
pairings in EffectStream correlate their two chains in Postgres, and zk-cardano
says outright that its eligibility is not enforced in the circuit, so a wallet
that never qualified can still be accepted. Here the private proof is what makes
the public action count, and the rollup enforces it.

The PoC already demonstrates this end to end: a post from the badge holder is
recorded accepted:true and a post from a key that never joined is
accepted:false, from the same program in the same moment. Rerunning logs
"reusing badge, already joined", which shows the nullifier preventing a second
badge. The nullifier map is deliberately not exported from the contract, so the
sync node cannot read it and joins cannot be counted or correlated.

Building it also surfaced a packaging bug I would report upstream.
@effectstream/sync aliases onchain-runtime to onchain-runtime-v3 while
compact-runtime depends on the real name, so a standalone install ends up with
two WASM instances and every contract ledger() read fails with a misleading
ChargedState error. The Midnight templates hide this inside link.sh, but a
standalone repo, which this task requires, gets no such help.

To be explicit about reuse: the Solana leg comes from solana-starter, the
Midnight wiring from evm-midnight-v2, the in-browser proving path from zswap-da
so the batcher never sees private inputs, and the identity idiom from
example-bboard, which is Midnight's canonical pattern. I am not claiming any ZK
novelty. What is new is the roster gate, the one-badge-per-person nullifier, and
the cross-chain arbiter. I could not find an existing Solana plus Midnight
template, so this would also be the first pairing of those two chains.
```

---

## Compact version

Use this if they want strictly one paragraph.

```
/claim

I want to build a different version of the Midnight bulletin board, and I have a
working proof of concept already running. example-bboard hides who posted, but
it cannot answer whether someone is allowed to post at all: it has no notion of
membership, so any wallet can post. My version proves membership once on
Midnight with a Compact circuit that checks a roster and burns a nullifier, so
each member gets exactly one anonymous badge, and that badge is just a fresh
Solana keypair. Posting then happens entirely on Solana, so Midnight holds only
the right to speak while the speech lives on the chain built for volume. The
EffectStream state machine is where the chains meet: it reads the badge set from
Midnight's ledger, reads posts from the Solana program log, and counts a post
only if its signer holds a badge. Every post is then provably from a real member
and no post can be traced to a person, including by whoever runs the servers.
All three existing Midnight pairings correlate their chains in Postgres, and
zk-cardano states outright that its eligibility is not enforced in the circuit.
The PoC already shows the badge holder's post recorded accepted:true and a
stranger's accepted:false from the same program in the same moment, with the
nullifier map deliberately unexported so joins cannot be counted or correlated.
Building it also surfaced a packaging bug I would report upstream:
@effectstream/sync aliases onchain-runtime to onchain-runtime-v3 while
compact-runtime depends on the real name, so a standalone install gets two WASM
instances and every contract ledger() read fails with a misleading ChargedState
error. I reuse the Solana leg from solana-starter, the Midnight wiring from
evm-midnight-v2, the browser proving path from zswap-da, and the identity idiom
from example-bboard; the roster gate, the one-badge-per-person nullifier and the
cross-chain arbiter are new. I could not find an existing Solana plus Midnight
template, so this would also be the first pairing of those two chains.
```

---

## Why it is structured this way

**Opens by naming bboard.** Every Midnight developer has read it, so one sentence
gives the reviewer a mental model to work from. It also gets the lineage
disclosure out of the way honestly, before anyone has to go looking for it.

**States what bboard does well before saying what it lacks.** Leading with the
gap reads as criticism. Leading with an accurate summary reads as someone who
actually read the contract.

**The "two questions" framing does the heavy lifting.** *Who posted* versus *are
they allowed to post* is a distinction anyone grasps immediately, and it makes
the contribution obvious without jargon.

**"Midnight holds only the right to speak; the speech lives on Solana."** That
one line explains the entire two-chain split, and it is the opposite
architectural choice to bboard, which stores the message on Midnight.

**Evidence is concrete.** `accepted:true` / `accepted:false`, same program, same
moment. No adjectives.

**"I am not claiming any ZK novelty" is deliberate.** Saying it outright is far
stronger than letting a reviewer notice the resemblance and wonder whether it
was being hidden.

**Left out on purpose:** the ordering bug (posts judged before badges finish
syncing) belongs in the first check-in, where it reads as a solved problem,
rather than in a claim where it reads as an unresolved risk.

**Hedged on purpose:** "I could not find an existing Solana plus Midnight
template" rather than asserting it, since a maintainer could correct that in one
reply. Verified by grepping every `templates/*/packages/node/config.dev.ts` for
Midnight, which turns up EVM, Bitcoin and Cardano only.

## Open before posting

- The roster source is generic in both drafts. DevRel may have a view on whether
  it should be Aliit membership, a Discord role, or a plain uploaded list.
