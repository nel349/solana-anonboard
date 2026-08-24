<div align="center">

# solana-anonboard

**Membership proven privately on Midnight · posting public and gasless on Solana.**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/screenshot-dark.png">
  <img alt="anonboard — the board shows every post, each labelled 'member' or 'not a member'" src="docs/media/screenshot-light.png" width="880">
</picture>

</div>

An anonymous bulletin board: the **right to post is proven in a Compact zero-knowledge circuit on Midnight**, and the **posts themselves live on Solana** (public, gasless). Posting is open to anyone — a post is only *marked as a member's* when its author proved membership, and no post traces back to a person, not even for whoever runs the servers. One [EffectStream](https://effectstream.dev) node reads both chains and ties them together through an anonymous badge. See **[Architecture](docs/architecture.md)** for how it works and why the privacy holds.

> Built on the Midnight Network.

## Quickstart

**Prerequisites** — [Bun](https://bun.sh) ≥ 1.3, **Rust** (`rustup`; `cargo-build-sbf` drives it to build the Solana program), a **C toolchain** (macOS: `xcode-select --install`; Debian/Ubuntu: `apt install build-essential`), and the **Compact compiler** (the contract compiles at boot; the artifact isn't committed):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh                                             # Rust
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh   # Compact
```

No Docker required — the localnet runs native vendored binaries. On the **first run** the Solana build toolchain and the Midnight node/indexer/proof binaries download, and the Rust program + Compact circuit compile, so expect a few minutes.

```bash
bun install
bun run dev            # the local `undeployed` chain — everything runs on your machine
```

When the checklist finishes, open **http://localhost:5173**. You can read the board straight away.

**To Join and post as a member you need a wallet — and which network you're on decides how:**

- **`bun run dev` — local (`undeployed`):** browser wallets (Lace, 1AM) don't support the local chain, so connect the **[mn CLI wallet](docs/mn-wallet.md)**, or run the headless demo: `bun run scripts/demo.ts`.
- **`bun run dev:preview` / `bun run dev:preprod` — hosted TestNet:** use a supported v4 browser wallet — or, on **preprod** (where a browser wallet's dust sync lags the large chain and the Join fails), the **[mn CLI wallet](docs/mn-wallet.md)**. Hosted nets also need a funded wallet + owner key — see **[Networks & accounts](docs/networks-and-accounts.md)**.

Either way the check is the same: a badge holder's post is marked **member**, a stranger's **not a member**, and both appear on the board.

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Sync node API | http://localhost:9999/api/posts · `/api/badges` |
| Batcher (fee-payer) | http://localhost:3334 |
| Operator | http://localhost:3335 |
| Midnight node / indexer / proof server | :9944 · :8088 · :6300 |

Manage a running stack from any terminal: `bun run dev:status`, `bun run dev:logs`, `bun run dev:stop`. Full workflow and troubleshooting in **[Development](docs/development.md)**.

## Documentation

- **[Architecture](docs/architecture.md)** — the two-chain design, the membership circuit, and the privacy guarantee.
- **[Networks & accounts](docs/networks-and-accounts.md)** — running on undeployed / preview / preprod, the two keys (payer wallet + roster owner), funding, and endpoints.
- **[Using the mn CLI wallet](docs/mn-wallet.md)** — the browser-wallet path for `undeployed` and preprod, via `mn serve`.
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
| `midnight-wallet-cli` (`mn`) | 0.5.0 (the 24/24 baseline; repo pins `^0.5.0`, now 0.5.1 — needs `dust export`) |

## Scope and limitations

This is an example on a dev chain, not a production build:

- **Dev-only trust:** a single funded operator wallet, permissive CORS, and no auth. The membership secret lives in the browser's `localStorage` for the demo — a real build must encrypt it.
- **Open roster:** the ZK guarantees a post is from *a roster member* — but roster admission is not gated in the demo. The operator's `/register` (and owner-only `add_to_roster`) admit anyone who asks, so one person can mint many badges. The privacy holds regardless; "membership" is only as meaningful as the admission policy a real build puts in front of `add_to_roster`.
- **Dev keys:** the Solana batcher fee-payer and program keypairs are **generated per clone** (gitignored, not committed). The fixed Midnight owner key (`packages/contracts-midnight/owner-key.ts`) is committed on purpose so the localnet demo runs out of the box; its secret is public and must **never** be funded or deployed on a real network. `deploy` and the operator refuse to run with the committed owner key on any network other than `undeployed`.
- **State persistence:** on `undeployed` a fresh `bun run dev` resets both chains to slot 0. On **devnet/preprod** the Solana program and its posts are persistent by design — a Midnight redeploy resets *membership* only, not the posts (which live in Solana accounts) or your badge (which lives in `localStorage`).
- **Cross-chain ordering:** Midnight's sync catches up from block 1 while Solana is already current, so a post can arrive before its badge. The arbiter holds it and backfills to accepted once the badge lands (the `reason` string records which path a post took).

## Acknowledgements

This project stands on significant open-source work. See [NOTICE](./NOTICE) for the full attribution; in short:

- **[EffectStream](https://github.com/effectstream/effectstream)** (MIT OR Apache-2.0) — the sync-node framework this is built on. Forked from its `solana-starter` template; the Solana round-trip, batcher, and frontend scaffolding are adapted from it.
- **[midnight-rs](https://github.com/Moonsong-Labs/midnight-rs)** by Moonsong Labs (MIT) — the Rust SDK for Midnight; the ledger and proving used here (via `@midnight-ntwrk/ledger-v8`) are built from it.
- **[Midnight JS SDK](https://github.com/midnight-ntwrk)** & **[Compact](https://github.com/LFDT-Minokawa/compact)** (Apache-2.0) — wallet, indexer, and zero-knowledge contract tooling.
- **[Solana web3.js](https://github.com/solana-labs)** (Apache-2.0) — the public, gasless posting/settlement layer.

Licensed under [Apache-2.0](./LICENSE).
