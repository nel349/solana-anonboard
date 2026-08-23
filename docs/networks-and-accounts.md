# Networks & accounts

anonboard picks a **Midnight** network and, independently, a **Solana** network. The proof server is always local. The Solana side defaults to a local validator but can run on **devnet** for persistent posts (see [Solana: local vs devnet](#solana-local-vs-devnet)).

| Midnight network | Node / indexer | Proof server | Deploy pays with | Roster owner |
|---|---|---|---|---|
| `undeployed` (default) | local (`bun run dev`) | local | the chain's genesis wallet (auto-funded) | committed dev key |
| `preview` | hosted TestNet | local | **your funded wallet** | **your owner key** |
| `preprod` | hosted TestNet | local | **your funded wallet** | **your owner key** |

## The two accounts

There are two distinct keys, with different jobs. On `undeployed` both default to throwaway local values; on a hosted net you supply both.

### 1. Payer wallet — `MIDNIGHT_WALLET_SEED`

The Midnight wallet that **pays** for the deploy transaction and for every `add_to_roster` / join the operator submits. It spends **NIGHT and dust**, so it must be funded on the target net.

- **`undeployed`:** the local chain's genesis wallet, funded automatically at genesis. You set nothing.
- **`preview` / `preprod`:** there is no genesis wallet, so you **must** set `MIDNIGHT_WALLET_SEED` to a 64-hex seed for a wallet you've funded (NIGHT + dust) on that net. An unset or unfunded seed fails at the payment step.

### 2. Roster owner — `MIDNIGHT_OWNER_KEY`

The roster admin: the identity that the owner-gated `add_to_roster` circuit checks. Both `deploy` and the operator use it.

- **`undeployed`:** the committed dev key in `packages/contracts-midnight/owner-key.ts` (`0x00…01`).
- **`preview` / `preprod`:** you **must** set `MIDNIGHT_OWNER_KEY` to your own 64-hex private key. The committed key is public in this repo, so `deploy` and the operator **refuse to run with it** off `undeployed` — otherwise anyone could forge memberships.

> These are separate roles even though both default to the trivial `…01` value locally. The payer is an HD **wallet** seed; the owner is the contract's **admin secret**.

## Running each network

```bash
bun run dev            # undeployed (local) — nothing to configure
bun run dev:preview    # preview  — loads .env.preview
bun run dev:preprod    # preprod  — loads .env.preprod
```

`dev:preview` / `dev:preprod` load their env file with `bun --env-file`; plain `bun run dev` never loads them, so the local flow is untouched.

### Setting up `.env.preview` / `.env.preprod`

Copy `.env.example` and fill in your values (these files are **gitignored** — they hold private keys, never commit them):

```
MIDNIGHT_NETWORK_ID=preview           # or preprod
MIDNIGHT_WALLET_SEED=<64-hex funded wallet seed>
MIDNIGHT_OWNER_KEY=<64-hex private owner key>
```

The wallet seed comes from `mn generate` (see below). The owner key is any 32 random bytes: `openssl rand -hex 32`.

### Funding the payer wallet on a hosted net

Use the `mn` CLI (installed with the repo). Keep the seed in `MN_SEED` so it stays off the process list.

```bash
mn generate                                          # prints a fresh 64-hex seed (or reuse your own)
MN_SEED=<64-hex seed> mn address --network preview   # prints the unshielded address to fund
```

1. Put that seed in `MIDNIGHT_WALLET_SEED` (in `.env.preview` / `.env.preprod`).
2. Request NIGHT from the faucet: [preview](https://midnight-tmnight-preview.nethermind.dev/) · [preprod](https://midnight-tmnight-preprod.nethermind.dev/) — send it to the address above.
3. Register dust so the wallet can pay fees:

```bash
MN_SEED=<64-hex seed> mn dust register --network preview
```

## Solana: local vs devnet

The Solana side is independent of the Midnight network. By default it runs a local `solana-test-validator` that **resets each `bun run dev`** (posts are ephemeral). Set `SOLANA_NETWORK=devnet` (or pick "devnet" at the startup prompt) to use hosted **devnet** instead, so **posts persist across restarts** like badges do.

- On devnet the boot faucet-funds the batcher fee-payer and reuses a **shared, immutable post program** — a cloner needs no `solana` CLI and no keypair.
- The program was deployed once (immutably) by the maintainer; its id and deploy slot live in [`packages/contracts-solana/devnet.ts`](../packages/contracts-solana/devnet.ts). Only that first-ever deploy needs the `solana` CLI (see `scripts/provision-devnet.ts`).

## Wallet connect

The browser join/prove flow needs a Midnight dapp-connector (v4) wallet.

- **`undeployed` (local): not supported.** Lace does not support the local network ([lace#2254](https://github.com/input-output-hk/lace/issues/2254)), and 1AM breaks switching between local and hosted (upstream, fix pending). For a local demo use the headless flow (`bun run scripts/demo.ts` / `scripts/blind-join.ts`).
- **`preview` / `preprod`: use a supported v4 wallet** pointed at that net. If it shows a stale "Network ID mismatch", disconnect the dApp and reconnect to re-bind.

## Endpoints

Every Midnight endpoint lives in one place: [`packages/contracts-midnight/networks.ts`](../packages/contracts-midnight/networks.ts). It flows to the frontend, sync node, deploy, and operator — change a URL once and it updates everywhere. The indexer API is **v4** for every network (per the [network release notes](https://docs.midnight.network/relnotes/network)); the proof server is always `http://127.0.0.1:6300`.

## Version compatibility

The versions this repo targets match the [Midnight support matrix](https://docs.midnight.network/relnotes/support-matrix) for preview/preprod, so a hosted run needs no dependency changes. The exact pinned versions live in one place — the "Verified against" table in the [README](../README.md).
