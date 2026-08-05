# Anonymous board on Solana + Midnight, joined by EffectStream

Proposal for [aliit-hub#170](https://github.com/midnightntwrk/aliit-hub/issues/170),
"Build a dApp that uses EffectStream."

A proof of concept is already built and running. This document describes what it
does, what is verified, what is left, and what I would report back upstream.

---

## 1. What it is, without jargon

It is a suggestion box with a bouncer.

A feedback board needs two things that normally fight each other. Only real
members should be able to post, or it fills with spam and outsiders. And nobody
should be able to tell who wrote what, or people only write the safe, useless
version.

Normally you cannot have both, because somebody has to check ID at the door, and
that somebody can then match you to your note. Every anonymous workplace app has
this hole. Blind verifies your work email, which means Blind holds a list
connecting you to everything you post. You are trusting a promise not to look.

This is the same box, except the check leaves no record behind. You have seen the
physical version: a secret ballot. You show ID to get a ballot, the ballot has no
name on it, and it goes in the box with everyone else's. The election is
verifiably legitimate and your vote is still private.

In practice: verify once that you belong, then post and vote freely, instantly,
for free. Every post is guaranteed to come from a real member. No post can be
traced to a person, not by other users, not by moderators, not by whoever runs
the servers, not by anyone who later asks for the data. There is no list to hand
over, because none was ever made.

## 2. The gap it fills

EffectStream ships three templates pairing Midnight with another chain, and all
three join the two chains **in Postgres**. Two say so themselves:

- `evm-midnight-v2`: the chains are correlated by "a shared key the user supplies
  to both sides." The user is the integrity boundary.
- `zk-cardano`: "Because eligibility is not proven in-circuit, a wallet that
  never delegated can still cast a vote that the contract accepts." Eligibility
  is a `GET /api/eligible/:credential` endpoint. Bypassable with curl.

This project makes the private proof a precondition for the public action, and
puts the enforcement in the rollup rather than in an API call.

There is also no Solana + Midnight template. Verified by grepping every
`templates/*/packages/node/config.dev.ts` for Midnight: EVM, Bitcoin and Cardano
only.

## 3. Architecture

```
  Midnight  (private, once, expensive)      Solana  (public, constant, cheap)
  ────────────────────────────────────      ────────────────────────────────
  join(solana_pubkey)                       post(), signed by the badge key
    prove roster membership                 sponsored, instant
    burn a nullifier
    disclose ONLY the badge
              │                                          │
              └──────────────┬───────────────────────────┘
                             ▼
                    EffectStream state machine
              badge in Midnight's ledger?  yes → count it
                                            no → drop it
```

Three files carry the whole idea:

| File | Role |
| --- | --- |
| `packages/contracts-midnight/contract-anonboard/src/anonboard.compact` | one circuit that matters: `join` |
| Solana program (`counter` in the PoC, a real `post` program in the build) | the public action |
| `packages/node/state-machine.ts` | the arbiter, one `if` |

It also teaches the Compact lesson that matters most. `badges` is exported, so
the rollup indexes it. `used`, the nullifier map, is not exported, so nobody can
count or correlate joins. Same file, one keyword, completely different privacy
outcome.

## 4. What is verified, by running it

| Claim | Status |
| --- | --- |
| One EffectStream node carries `SOLANA_RPC_PARALLEL` + `MIDNIGHT_PARALLEL` | **PASS**, zero sync errors |
| Compact circuit compiles on the support-matrix compiler | **PASS** |
| Contract deploys to Midnight | **PASS**, repeatedly |
| `join` proves membership and mints a badge | **PASS** |
| One badge per member (nullifier) | **PASS**, rerun logs "reusing badge … already joined" |
| Nullifier map invisible to the sync node | **PASS**, absent from generated `Ledger` type |
| Badge mirrored from Midnight ledger into Postgres | **PASS** |
| **Arbiter accepts badge holder, rejects stranger** | **PASS** |

The result that matters:

```
id=1  bh=78   accepted=false  CzHwDZ86…  no midnight badge
id=2  bh=79   accepted=false  DomViusS1…  no midnight badge
id=3  bh=150  accepted=true   CzHwDZ86…  badge verified on midnight
id=4  bh=151  accepted=false  7aM2vTui…  no midnight badge
```

Same program, same moment. id=3 proved membership; id=4 never joined. ids 1 and 3
are the same key, differing only in whether the badge had finished syncing, which
is the caveat in section 6.

Reproduce with `bun install`, `bunx orchestrator start`, `bun run scripts/demo.ts`.

## 5. What is reused, and what is new

Stated plainly because the acceptance criteria ask for it.

**Reused:** the Solana leg from `solana-starter` (sponsored fee-payer batcher,
`SOLANA:ProgramLog` indexing). The Midnight wiring from `evm-midnight-v2`
(`launchMidnight`, contract deploy and read). The in-browser proving path from
`zswap-da`, so the batcher never sees private inputs. The identity idiom from
`example-bboard`, which is Midnight's canonical pattern.

**New:** the roster gate, the one-badge-per-person nullifier, the cross-chain
arbiter, and the Solana + Midnight pairing itself. `example-bboard` hides *who
posted* but has no concept of membership, no sybil resistance, is a single-slot
board, and stores the message on Midnight. This stores only the *right to speak*
on Midnight and puts the speech on a chain built for volume.

I am not claiming ZK novelty. The claim is architectural, and it is the part the
bounty is asking about.

## 6. Known issues, with fixes

**Ordering.** Midnight syncs from block 1 at chain speed while Solana is already
current, so a post can be folded and judged before its badge arrives. That is
what ids 1 and 2 above show. `evm-midnight-v2`'s README describes the same
out-of-order problem. Fix: placeholder row plus `ON CONFLICT … DO UPDATE`, and
re-evaluate pending posts when a badge lands.

**Duplicate WASM runtime (upstream).** `@effectstream/sync` depends on
`"@midnight-ntwrk/onchain-runtime": "npm:@midnight-ntwrk/onchain-runtime-v3@3.0.0"`
while `@midnight-ntwrk/compact-runtime` depends on `onchain-runtime-v3` under its
real name. Same package, same version, two names, so a standalone install writes
two copies, giving two WASM instances and two distinct `StateValue` classes. The
generated contract reader does:

```js
x instanceof __compactRuntime.StateValue ? x : x.state
```

so a `StateValue` built by the sync fetcher fails the check, silently takes the
wrong branch, and throws `expected instance of ChargedState`, which names nothing
useful. Symlinking the alias to the real package fixes it and the sync node goes
from 17 errors per run to zero. Shipped here as a `postinstall`. The Midnight
templates hide this inside `link.sh`; a standalone repo, which this task
requires, gets no such help. **Worth an upstream issue.**

**Three midnight-js call shapes** found the same way, small but undocumented:
`findDeployedContract` takes `{ compiledContract }` not `{ contract }`; the
contract must come from `CompiledContract.make(...).pipe(withWitnesses,
withCompiledFileAssets)` rather than `new X.Contract()`; and `setNetworkId()` must
precede any wallet or contract operation.

## 7. Plan

Day 1 is done: the architecture is proven and the hard blocker is fixed.

| Days | Work |
| --- | --- |
| 1–3 | Real `post` program on Solana carrying message bytes, replacing the counter stand-in |
| 4–6 | Fix the ordering issue; re-evaluate pending posts when a badge lands |
| 7–9 | Roster admin flow and a browser join, using the `zswap-da` proving path so the operator never sees private inputs |
| 10–12 | Frontend, plus PRC-6 `/metrics` with the `verifications` and `access_grants` channels |
| 13–14 | README tutorial, Awesome dApps listing PR, buffer |

PRC-6 is the first thing to cut if anything runs long. It is the most separable
piece.

## 8. What I would want from DevRel

1. Is the idea approved, and is the framing right?
2. Roster source: Aliit membership, a Discord role, or a plain uploaded list?
3. Should the WASM duplicate go to the EffectStream repo as an issue, a PR, or
   both?
4. The support matrix lists Compact compiler 0.31.1; the templates pin 0.31.0.
   Which should a submission target?
