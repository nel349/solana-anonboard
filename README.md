# solana-anonboard

An anonymous bulletin board where the **right to post is proven privately on Midnight** and the **posts themselves live on Solana**. Membership is checked once in a Compact zero-knowledge circuit; posting is public and gasless. One [EffectStream](https://effectstream.dev) node reads both chains and counts a post only if its author proved membership — without ever learning which member.

> This project is built on the Midnight Network.

## The idea

[`example-bboard`](https://github.com/midnightntwrk/example-bboard) can hide *who* posted, but not *whether they're allowed to*: any wallet can post. This flips that. It answers "is this person a member?" privately, and puts each half on the chain that suits it:

- **Membership is proven once, on Midnight.** A Compact circuit checks a roster and burns a nullifier, so each member earns exactly one anonymous badge. The badge is just a fresh Solana public key.
- **Posting happens on Solana**, where it's fast and cheap. Midnight holds only the right to speak; the speech lives on the chain built for volume.
- **The EffectStream state machine joins the two.** It mirrors the badge set from Midnight's public ledger and reads posts from the Solana program log, and **accepts a post only if its signer holds a badge.**

Every accepted post is provably from a real member, and no post traces back to a person — not even for whoever runs the servers. The privacy rests on one detail: the nullifier map that enforces one-badge-per-member is **not exported** from the contract, so the sync node can never read it and joins can't be counted or correlated. In Compact, what a circuit exports is exactly what the rollup gets to see.

## How it fits together

| Package | Role |
|---|---|
| `contracts-midnight` | The Compact `anonboard` contract — roster, badges, and the `join` circuit that proves membership and burns a nullifier. |
| `contracts-solana` | The Solana program that records posts (a `Post` instruction emitting one log line per post). |
| `node` | The EffectStream sync node: mirrors Midnight badges into Postgres and runs the arbiter that accepts a post only if its author holds a badge. |
| `operator` | Midnight-side service: registers members on the roster (`add_to_roster`). It also exposes an operator-blind `/submit` (pay+submit a browser-proven join **without seeing the secret**) — a reference endpoint not wired into the shipped flows: the UI join is wallet-paid, and the headless `scripts/blind-join.ts` builds the join in-process. |
| `batcher` | Solana fee-payer: co-signs and submits user-signed posts so the author never needs SOL. |
| `frontend` | Vite + React UI: connect a Midnight wallet, join, and post. |
| `database` | PGLite schema + typed queries for badges and posts. |

## Quickstart

You need [Bun](https://bun.sh) ≥ 1.3. The Solana and Midnight toolchains are vendored — the first run downloads them. The stack binds fixed localhost ports, so these must be free (and bindable): `5432` (PGLite), `8899`/`9900` (Solana), `9999` (sync node API), `3334` (batcher), `3335` (operator), `5173` (frontend), plus `9944`/`8088`/`6300` when self-hosting Midnight.

```bash
bun install
bun run dev
```

`bun run dev` brings the whole stack up in dependency order — Solana validator, a Midnight localnet (it **attaches** to a healthy one already running on :9944/:8088/:6300, otherwise starts a fresh one — see `localnet-preflight.ts`), the compiled contract (deployed once), the sync node, the operator, the gasless batcher, and the frontend. When it settles, open:

```
http://localhost:5173
```

From there: connect Lace or 1AM, click **Join** (the operator registers your membership key, then membership is proved in your browser — the secret never leaves it — and your wallet pays and submits the join), then post. A post from a badge holder is accepted; a post from a stranger is rejected — both are shown, so you can see the check working.

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Sync node API | http://localhost:9999/api/posts · `/api/badges` |
| Batcher (fee-payer) | http://localhost:3334 |
| Operator | http://localhost:3335 |
| Midnight node / indexer / proof server | :9944 · :8088 · :6300 |

To wipe the local chain and start clean: `bun run --filter @solana-anonboard/contracts-midnight midnight:reset`.

There are also headless scripts for the same flow without the UI: `scripts/demo.ts` (end-to-end), `scripts/blind-join.ts` (operator-blind join), `scripts/gasless-post.ts` (gasless post).

## Verified against

The contract compiles and the loop runs end-to-end (browser-verified 2026-08-08) against:

| Component | Version |
|---|---|
| Compact compiler / language | 0.31.0 / 0.23.0 |
| `@midnight-ntwrk/compact-runtime` | 0.16.0 |
| `@midnight-ntwrk/ledger-v8` | 8.1.0 |
| `@midnight-ntwrk/midnight-js-*` | 4.1.1 |
| EffectStream | 0.102.0 |

## Scope and limitations

This is an example on a local dev chain, not a production build:

- **Dev-only trust:** a single funded operator wallet, permissive CORS, and no auth. The membership secret lives in the browser's `localStorage` for the demo — a real build must encrypt it.
- **Committed dev keypairs:** the batcher fee-payer (`packages/batcher/keypair/batcher-wallet.json`) and the deterministic program id (`packages/contracts-solana/keypair/anonboard-program.json`) are committed on purpose so the localnet demo runs out of the box. Their secrets are public — they must **never** be funded or deployed on a real network.
- **Cross-chain ordering:** Midnight's sync catches up from block 1 while Solana is already current, so a post can arrive before its badge. The arbiter holds it and backfills to accepted once the badge lands (the `reason` string records which path a post took).
- **Local validator retention:** the vendored Solana validator can't cap its ledger size, so a long-running localnet eventually prunes blocks the sync still needs and wedges. A fresh `bun run dev` resets both to slot 0.

## Credit

Forked from EffectStream's `solana-starter` template; the Solana round-trip, batcher, and frontend scaffolding are adapted from it. Licensed under [Apache-2.0](./LICENSE).
