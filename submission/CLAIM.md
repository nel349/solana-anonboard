# Claim comment for aliit-hub#170

Paste the **Primary version** below as a comment on
https://github.com/midnightntwrk/aliit-hub/issues/170

Check first whether DevRel wants the idea validated before the `/claim` comment
or as part of it. The task text implies validation comes first.

> **Note on the PoC.** These drafts do not mention the working proof of concept,
> because the task states that work begun before approval is not eligible. They
> claim only what is defensible: prior experience with the Midnight stack, and
> feasibility conclusions drawn from reading the templates and dependency graph.
>
> If anyone asks directly whether this has been prototyped, say yes. Feasibility
> investigation before a proposal is ordinary due diligence and is not the same
> as building the deliverable. Omitting it from a claim is fine; denying it would
> not be.

---

## Primary version

```
/claim

I want to build a different version of the Midnight bulletin board.

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

One design detail matters for privacy: the nullifier map that enforces one badge
per member is deliberately not exported from the contract, so the sync node
cannot read it and joins cannot be counted or correlated. Designing the circuit
is designing what the rollup is allowed to see.

This is the part the existing templates stop short of. All three Midnight
pairings in EffectStream correlate their two chains in Postgres, and zk-cardano
says outright that its eligibility is not enforced in the circuit, so a wallet
that never qualified can still be accepted. Here the private proof is what makes
the public action count, and the rollup enforces it.

On feasibility, I maintain midnight-wallet-cli, a CLI wallet and MCP server for
Midnight, so I already work with the Compact toolchain, dust, the indexer and
the dapp-connector API day to day. From reading the templates, the composition
this needs is the framework's supported shape: evm-midnight-v2 runs an NTP main
protocol with EVM and Midnight as parallel siblings, and solana-starter runs the
same NTP main with Solana, so pairing Solana and Midnight under one clock is
assembly rather than engine work. I have also traced one packaging problem I
expect to hit and would report upstream: @effectstream/sync aliases
onchain-runtime to onchain-runtime-v3 while compact-runtime depends on the real
name, which in a standalone install resolves to two copies of the same WASM
runtime and breaks instanceof checks inside a contract's generated ledger()
reader. The Midnight templates avoid it via link.sh, but a standalone repo,
which this task requires, gets no such help.

To be explicit about reuse: the Solana leg would come from solana-starter, the
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

I want to build a different version of the Midnight bulletin board.
example-bboard hides who posted, but it cannot answer whether someone is allowed
to post at all: it has no notion of membership, so any wallet can post. My
version proves membership once on Midnight with a Compact circuit that checks a
roster and burns a nullifier, so each member gets exactly one anonymous badge,
and that badge is just a fresh Solana keypair. Posting then happens entirely on
Solana, so Midnight holds only the right to speak while the speech lives on the
chain built for volume. The EffectStream state machine is where the chains meet:
it reads the badge set from Midnight's ledger, reads posts from the Solana
program log, and counts a post only if its signer holds a badge. Every post is
then provably from a real member and no post can be traced to a person,
including by whoever runs the servers. The nullifier map is deliberately not
exported from the contract, so the sync node cannot read it and joins cannot be
counted or correlated. This is where the existing templates stop short: all
three Midnight pairings correlate their chains in Postgres, and zk-cardano
states outright that its eligibility is not enforced in the circuit. On
feasibility, I maintain midnight-wallet-cli, a CLI wallet and MCP server for
Midnight, so I work with the Compact toolchain, dust and the indexer regularly,
and the composition this needs is the framework's supported shape, since
evm-midnight-v2 and solana-starter both hang their chains off an NTP main
protocol as parallel siblings. I reuse the Solana leg from solana-starter, the
Midnight wiring from evm-midnight-v2, the browser proving path from zswap-da,
and the identity idiom from example-bboard; the roster gate, the
one-badge-per-person nullifier and the cross-chain arbiter are new. I could not
find an existing Solana plus Midnight template, so this would also be the first
pairing of those two chains.
```

---

## Why it is structured this way

**Opens by naming bboard.** Every Midnight developer has read it, so one sentence
gives the reviewer a mental model. It also volunteers the lineage before anyone
has to go looking for it.

**States what bboard does well before naming the gap.** Leading with the gap
reads as criticism. Leading with an accurate summary reads as someone who
actually read the contract.

**The "two questions" framing does the heavy lifting.** *Who posted* versus *are
they allowed to post* is a distinction anyone grasps immediately, and it makes
the contribution obvious without jargon.

**"Midnight holds only the right to speak; the speech lives on Solana."** One
line explaining the whole two-chain split, and it is the opposite architectural
choice to bboard, which stores the message on Midnight.

**Feasibility is argued from credentials and from reading, not from a build.**
Maintaining midnight-wallet-cli is verifiable and directly relevant. The NTP
main plus parallel siblings observation comes from the template configs, which
anyone can check.

**The packaging problem is framed as traced, not encountered.** It is visible in
the dependency graph without running anything, so the claim holds up. It signals
depth and is genuinely useful to the EffectStream maintainers.

**"I am not claiming any ZK novelty" is deliberate.** Saying it outright is far
stronger than letting a reviewer notice the resemblance and wonder whether it was
being hidden.

**Hedged on purpose:** "I could not find an existing Solana plus Midnight
template" rather than asserting it, since a maintainer could correct that in one
reply. Verified by grepping every `templates/*/packages/node/config.dev.ts` for
Midnight, which turns up EVM, Bitcoin and Cardano only.

## Open before posting

- The roster source is generic in both drafts. DevRel may have a view on whether
  it should be Aliit membership, a Discord role, or a plain uploaded list.
- `DEVREL-PROPOSAL.md` still contains the full PoC evidence table and results.
  Decide whether DevRel sees that version or a feasibility-only variant before
  sending it.
