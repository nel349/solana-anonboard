# Claim comment for aliit-hub#170

Paste the **Primary version** below as a comment on
<https://github.com/midnightntwrk/aliit-hub/issues/170>

Check first whether DevRel wants the idea validated before the `/claim` comment
or as part of it. The task text implies validation comes first.

> **Note on the PoC.** These drafts do not mention the working proof of concept,
> because the task states that work begun before approval is not eligible. They
> claim only what is defensible: feasibility conclusions drawn from reading the
> templates and the dependency graph. If anyone asks directly whether this has
> been prototyped, say yes; feasibility investigation before a proposal is
> ordinary due diligence and is not building the deliverable. Omitting it from a
> claim is fine; denying it would not be.

All factual claims below were verified against the effectstream source on
2026-08-04. See the [Verification note](#verification-note-checked-2026-08-04) at
the end.

---

## Primary version

Copy everything from `/claim` down. It is GitHub-flavored markdown, so it renders
when you paste it into the comment box.

/claim

I want to build a different version of the Midnight bulletin board.

### The idea

[`example-bboard`](https://github.com/midnightntwrk/example-bboard) can hide *who posted*. It records a commitment, so the poster can later prove a post was theirs without the chain knowing who they are. What it does not do is answer the other question every real board has to answer: **is this person allowed to post at all?** It has no idea of membership, so any wallet can post. It also holds one message at a time, and the message itself lives on Midnight.

My version handles both, and puts each half on the chain that suits it.

### How it works

- **Membership is proven once, on Midnight.** A Compact circuit checks a roster and burns a nullifier, so each member gets exactly one anonymous badge. That badge is just a fresh Solana keypair.
- **Posting happens on Solana,** where it is fast and cheap. Midnight only holds the right to speak. The speech itself lives on the chain built for volume.
- **The EffectStream state machine joins the two.** It reads the badge set from Midnight's public ledger, reads posts from the Solana program log, and **counts a post only if its signer holds a badge.**

So every post is provably from a real member, and no post can be traced back to a person, not even by whoever runs the servers. The privacy rests on one detail: the nullifier map that enforces one badge per member is deliberately not exported from the contract, so the sync node cannot read it and joins cannot be counted or correlated. In Compact, what the circuit exports is exactly what the rollup gets to see.

### Why it is different

This is where the existing templates stop. All three Midnight pairings in EffectStream join their two chains in the node's database, and [`zk-cardano`](https://github.com/effectstream/effectstream/tree/v-next/templates/zk-cardano) says outright that its eligibility is not enforced in the circuit, so a wallet that never qualified can still be accepted. In my version the private proof is what makes the public action count, and the rollup enforces that.

### Why it is feasible

The composition is the framework's normal shape, not new engine work. `evm-midnight-v2` hangs EVM and Midnight off an NTP main protocol as parallel siblings, and `solana-starter` hangs Solana off the same NTP main, so running Solana and Midnight under one clock is assembly. The privacy path is already shown by `zswap-da`, which proves in the browser and calls `balanceUnsealedTransaction` with `payFees: false`. The wallet seals a locally-proven transaction without spending its own Dust and the batcher pays, so the batcher never sees the private inputs.

Building toward it, I also traced a packaging problem I would report upstream. `@effectstream/sync` aliases `onchain-runtime` to `onchain-runtime-v3` while `compact-runtime` depends on the real name, so a standalone install ends up with two copies of the same WASM runtime and the `instanceof` check inside a contract's generated `ledger()` reader breaks. The Midnight templates work around it inside `link.sh`, but a standalone repo, which this task asks for, gets no such help.

### What is reused, what is new

I would reuse the Solana leg from `solana-starter`, the Midnight wiring from `evm-midnight-v2`, the in-browser proving path from `zswap-da`, and the identity pattern from `example-bboard`, which is Midnight's own. I am not claiming any ZK novelty. What is new is the roster gate, the one-badge-per-person nullifier, and the cross-chain arbiter. I could not find an existing Solana and Midnight template, so this would also be the first pairing of those two chains.

---

## Compact version

Use this if they want strictly one paragraph.

/claim

I want to build a different version of the Midnight bulletin board. [`example-bboard`](https://github.com/midnightntwrk/example-bboard) hides *who posted*, but it cannot answer whether someone is **allowed** to post at all, because it has no idea of membership and any wallet can post. My version proves membership once on Midnight with a Compact circuit that checks a roster and burns a nullifier, so each member gets exactly one anonymous badge, and that badge is just a fresh Solana keypair. Posting then happens on Solana, so Midnight only holds the *right to speak* while the speech lives on the chain built for volume. The EffectStream state machine joins the chains: it reads the badge set from Midnight's ledger, reads posts from the Solana program log, and **counts a post only if its signer holds a badge**. Every post is then provably from a real member, and no post can be traced to a person, not even by whoever runs the servers, because the nullifier map is deliberately not exported from the contract. This is where the existing templates stop: all three Midnight pairings join their chains in the node's database, and `zk-cardano` states outright that its eligibility is not enforced in the circuit. On feasibility, the composition is the framework's normal shape, since `evm-midnight-v2` and `solana-starter` both hang their chains off an NTP main protocol as parallel siblings, and the privacy path is already shown by `zswap-da`, which proves in the browser and calls `balanceUnsealedTransaction` with `payFees: false` so the batcher pays without seeing the private inputs. I reuse the Solana leg from `solana-starter`, the Midnight wiring from `evm-midnight-v2`, the browser proving path from `zswap-da`, and the identity pattern from `example-bboard`; the roster gate, the one-badge-per-person nullifier, and the cross-chain arbiter are new. I could not find an existing Solana and Midnight template, so this would also be **the first pairing of those two chains**.

---

## Why it is structured this way

**Opens by naming bboard.** Every Midnight developer has read it, so one sentence
gives the reviewer a mental model. It also volunteers the lineage before anyone
has to go looking for it.

**States what bboard does well before naming the gap.** Leading with the gap
reads as criticism; leading with an accurate summary reads as someone who
actually read the contract.

**The "two questions" framing does the heavy lifting.** *Who posted* versus *are
they allowed to post* is a distinction anyone grasps immediately, and it makes
the contribution obvious without jargon.

**"Midnight holds only the right to speak; the speech lives on Solana."** One
line explaining the whole two-chain split, and it is the opposite architectural
choice to bboard, which stores the message on Midnight.

**Feasibility is argued from the framework, not from a build or a résumé.** The
NTP-main-plus-parallel-siblings shape and the zswap-da payFees:false path are
both readable in the repo, so the case stands on facts anyone can check. The team
already knows the author, so credentials are left out.

**"I am not claiming any ZK novelty" is deliberate.** Saying it outright is far
stronger than letting a reviewer notice the resemblance and wonder whether it was
being hidden.

---

## Verification note (checked 2026-08-04)

Against `effectstream/effectstream` @ `v-next`.

- **zk-cardano eligibility not in-circuit:** `zk-cardano/README.md` line 117,
  verbatim: "Because eligibility is not proven in-circuit, a wallet that never
  delegated can still cast a vote that the contract accepts."
- **evm-midnight-v2 = NTP main + parallel siblings:** `config.dev.ts`:
  `NTP_MAIN`, `EVM_RPC_PARALLEL`, `MIDNIGHT_PARALLEL`. solana-starter uses the
  same `NTP_MAIN` + `SOLANA_RPC_PARALLEL` shape.
- **zswap-da browser proving:** `browserContract.ts` lines 95–97 call
  `balanceUnsealedTransaction(..., { payFees: false })`; proving via
  `httpClientProofProvider` + `CompiledContract.withWitnesses`.
- **all three pairings correlate in the node DB:** evm-midnight
  (`insertEvmMidnight`), night-bitcoin-v2 (`getIntentByOrderId` +
  `insertTransfer`, "the node arbitrates"), zk-cardano (README). None enforces
  the link in-circuit. Note: night-bitcoin correlates by order id in the node,
  not a user-supplied shared key.
- **@effectstream/sync alias:** `sync/package.json` line 22:
  `"@midnight-ntwrk/onchain-runtime": "npm:@midnight-ntwrk/onchain-runtime-v3@3.0.0"`.
- **first Solana+Midnight pairing:** grep of every
  `templates/*/packages/node/config.dev.ts` for Midnight returns only EVM,
  Bitcoin, Cardano. Hedged as "I could not find" since a maintainer could
  correct it.

---

## Open before posting

- The roster source is generic in both drafts. DevRel may have a view on whether
  it should be Aliit membership, a Discord role, or a plain uploaded list.
- `DEVREL-PROPOSAL.md` still contains the full PoC evidence table and results.
  Decide whether DevRel sees that version or a feasibility-only variant before
  sending it.
