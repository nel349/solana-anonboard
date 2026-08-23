# solana-anonboard

An anonymous bulletin board where the **right to post is proven privately on Midnight** and the **posts themselves live on Solana**. Membership is checked once in a Compact zero-knowledge circuit; posting is public and gasless. One [EffectStream](https://effectstream.dev) node reads both chains and counts a post only if its author proved membership — without ever learning which member.

Every accepted post is provably from a member on the roster, and no post traces back to a person — not even for whoever runs the servers. See **[Architecture](docs/architecture.md)** for how it works and why the privacy holds.

> This project is built on the Midnight Network.

## Quickstart

You need [Bun](https://bun.sh) ≥ 1.3, **Rust** (`rustup` — `cargo-build-sbf` drives it to build the Solana program), and the **Compact compiler** (the contract is compiled at boot and the artifact is not committed):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh                                             # Rust
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh   # Compact
```

No Docker required; the localnet runs native vendored binaries. The vendored Solana build toolchain (`cargo-build-sbf`) and the Midnight node/indexer/proof binaries download on the **first run**, which also compiles the Rust Solana program + the Compact circuit — so expect a few minutes.

```bash
bun install
bun run dev
```

`bun run dev` brings the whole stack up in dependency order and shows a live checklist. When it's ready, open:

```
http://localhost:5173
```

Browser wallets (Lace, 1AM) do **not** support the local `undeployed` network, so for the local demo run the headless loop instead: `bun run scripts/demo.ts` (it joins, posts, and shows the accept/reject check). To drive the browser UI, run against a hosted net (`bun run dev:preview`) with a supported wallet — see [Networks & accounts](docs/networks-and-accounts.md#wallet-connect). Either way, a post from a badge holder is accepted and a post from a stranger is rejected; both are shown, so you can see the check working.

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Sync node API | http://localhost:9999/api/posts · `/api/badges` |
| Batcher (fee-payer) | http://localhost:3334 |
| Operator | http://localhost:3335 |
| Midnight node / indexer / proof server | :9944 · :8088 · :6300 |

Manage the running stack from any terminal: `bun run dev:status`, `bun run dev:logs`, `bun run dev:stop`. To run against a hosted TestNet: `bun run dev:preview` (or `dev:preprod`). Full workflow and troubleshooting in **[Development](docs/development.md)**.

## Documentation

- **[Architecture](docs/architecture.md)** — the two-chain design, the membership circuit, and the privacy guarantee.
- **[Networks & accounts](docs/networks-and-accounts.md)** — running on undeployed / preview / preprod, the two keys (payer wallet + roster owner), funding, and endpoints.
- **[Development](docs/development.md)** — the `dev:*` commands, headless scripts, tests, and troubleshooting.

## Verified against

The contract compiles and the loop runs end-to-end (verified 2026-08-22 — E2E suite green, 24/24) against:

| Component | Version |
|---|---|
| Compact compiler / language | 0.31.0 / 0.23.0 |
| `@midnight-ntwrk/compact-runtime` | 0.16.0 |
| `@midnight-ntwrk/ledger-v8` | 8.1.0 |
| `@midnight-ntwrk/midnight-js-*` | 4.1.1 |
| EffectStream | 0.102.0 |
| `midnight-wallet-cli` (`mn`) | 0.5.0 (needs `dust export`) |

## Scope and limitations

This is an example on a local dev chain, not a production build:

- **Dev-only trust:** a single funded operator wallet, permissive CORS, and no auth. The membership secret lives in the browser's `localStorage` for the demo — a real build must encrypt it.
- **Open roster:** the ZK guarantees a post is from *a roster member* — but roster admission is not gated in the demo. The operator's `/register` (and owner-only `add_to_roster`) admit anyone who asks, so one person can mint many badges. The privacy holds regardless; "membership" is only as meaningful as the admission policy a real build puts in front of `add_to_roster`.
- **Dev keys:** the Solana batcher fee-payer and program keypairs are **generated per clone** (gitignored, not committed), so each clone gets its own. The fixed Midnight owner key (`packages/contracts-midnight/owner-key.ts`) is committed on purpose so the localnet demo runs out of the box; its secret is public and must **never** be funded or deployed on a real network. `deploy` and the operator refuse to run with the committed owner key on any network other than `undeployed`.
- **Cross-chain ordering:** Midnight's sync catches up from block 1 while Solana is already current, so a post can arrive before its badge. The arbiter holds it and backfills to accepted once the badge lands (the `reason` string records which path a post took).
- **Local validator retention:** the vendored Solana validator can't cap its ledger size, so a long-running localnet eventually prunes blocks the sync still needs and wedges. A fresh `bun run dev` resets both to slot 0.

## Acknowledgements

This project stands on significant open-source work. See [NOTICE](./NOTICE) for the full attribution; in short:

- **[EffectStream](https://github.com/effectstream/effectstream)** (MIT OR Apache-2.0) — the sync-node framework this is built on. Forked from its `solana-starter` template; the Solana round-trip, batcher, and frontend scaffolding are adapted from it.
- **[midnight-rs](https://github.com/Moonsong-Labs/midnight-rs)** by Moonsong Labs (MIT) — the Rust SDK for Midnight; the ledger and proving used here (via `@midnight-ntwrk/ledger-v8`) are built from it.
- **[Midnight JS SDK](https://github.com/midnight-ntwrk)** & **[Compact](https://github.com/LFDT-Minokawa/compact)** (Apache-2.0) — wallet, indexer, and zero-knowledge contract tooling.
- **[Solana web3.js](https://github.com/solana-labs)** (Apache-2.0) — the public, gasless posting/settlement layer.

Licensed under [Apache-2.0](./LICENSE).
