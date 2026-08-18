# Architecture

anonboard is an anonymous bulletin board where the **right to post is proven privately on Midnight** and the **posts themselves live on Solana**. Membership is checked once in a Compact zero-knowledge circuit; posting is public and gasless. One [EffectStream](https://effectstream.dev) node reads both chains and counts a post only if its author proved membership — without ever learning which member.

## The idea

[`example-bboard`](https://github.com/midnightntwrk/example-bboard) can hide *who* posted, but not *whether they're allowed to*: any wallet can post. anonboard flips that. It answers "is this person a member?" privately, and puts each half on the chain that suits it:

- **Membership is proven once, on Midnight.** A Compact circuit checks a roster and burns a nullifier, so each member earns exactly one anonymous badge. The badge is just a fresh Solana public key.
- **Posting happens on Solana**, where it's fast and cheap. Midnight holds only the right to speak; the speech lives on the chain built for volume.
- **The EffectStream state machine joins the two.** It mirrors the badge set from Midnight's public ledger and reads posts from the Solana program log, and **accepts a post only if its signer holds a badge.**

## Components

| Package | Role |
|---|---|
| `contracts-midnight` | The Compact `anonboard` contract — roster, badges, and the `join` circuit that proves membership and burns a nullifier. |
| `contracts-solana` | The Solana program that records posts (a `Post` instruction emitting one log line per post). |
| `node` | The EffectStream sync node: mirrors Midnight badges into PGLite and runs the arbiter that accepts a post only if its author holds a badge. |
| `operator` | Midnight-side service: registers a member's public key on the roster (owner-only `add_to_roster`) — it never sees the member's secret. |
| `batcher` | Solana fee-payer: co-signs and submits user-signed posts so the author never needs SOL. |
| `frontend` | Vite + React UI: connect a Midnight wallet, join, and post. |
| `database` | PGLite schema + typed queries for badges and posts. |

## The membership circuit

Membership is proven against a **Merkle roster** (`HistoricMerkleTree`), so a join discloses only the roster **root** — never which member it is:

1. The member's identity commitment (`public_key(secret)`) is added to the roster tree by the owner (`add_to_roster`, owner-gated).
2. To join, the browser witnesses a **private** Merkle path to that leaf and proves, in zero knowledge, that `pk == path.leaf` and that the path hashes to a roster root the tree has held. Only the root is made public — and it is identical for every member.
3. The circuit burns a one-shot **nullifier** (a one-way hash of the secret), so each member can mint exactly one badge.

## The privacy guarantee

Every accepted post is provably from a member on the roster, and no post traces back to a person — not even for whoever runs the servers. The guarantee rests on one detail: the **nullifier map that enforces one-badge-per-member is not exported** from the contract, so the sync node (and everyone else) can never read it and joins can't be counted or correlated. In Compact, what a circuit exports is exactly what the rollup gets to see.

> Scope note: the ZK proves membership *of the roster*. Admitting someone to the roster is the operator's `add_to_roster` policy — ungated in this demo (see [Scope](../README.md#scope-and-limitations)).

## The cross-chain flow

Midnight's sync catches up from block 1 while Solana is already current, so a post can arrive **before** its author's badge has synced. The arbiter holds such a post as rejected and **backfills** it to accepted once the badge lands. Both accepted and rejected posts are shown in the UI, so you can watch the check working; the `reason` string records which path each post took.
