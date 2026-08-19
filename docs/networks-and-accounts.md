# Networks & accounts

anonboard runs against one of three Midnight networks. **Solana and the proof server are always local** — only Midnight's node and indexer move to a hosted net.

| Network | Midnight node / indexer | Proof server | Solana | Deploy pays with | Roster owner |
|---|---|---|---|---|---|
| `undeployed` (default) | local (`bun run dev`) | local | local | the chain's genesis wallet (auto-funded) | committed dev key |
| `preview` | hosted TestNet | local | local | **your funded wallet** | **your owner key** |
| `preprod` | hosted TestNet | local | local | **your funded wallet** | **your owner key** |

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

### Funding the payer wallet on a hosted net

1. Get the wallet's unshielded address for the net.
2. Request NIGHT from the faucet: [preview](https://midnight-tmnight-preview.nethermind.dev/) · [preprod](https://midnight-tmnight-preprod.nethermind.dev/).
3. Register dust so the wallet can pay fees (e.g. via the `mn` CLI: `mn dust register`).

## Endpoints

Every Midnight endpoint lives in one place: [`packages/contracts-midnight/networks.ts`](../packages/contracts-midnight/networks.ts). It flows to the frontend, sync node, deploy, and operator — change a URL once and it updates everywhere. The indexer API is **v4** for every network (per the [network release notes](https://docs.midnight.network/relnotes/network)); the proof server is always `http://127.0.0.1:6300`.

## Version compatibility

The versions this repo targets match the [Midnight support matrix](https://docs.midnight.network/relnotes/support-matrix) for preview/preprod, so a hosted run needs no dependency changes. The exact pinned versions live in one place — the "Verified against" table in the [README](../README.md).
