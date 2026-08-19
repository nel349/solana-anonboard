# Development

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.3. The Solana and Midnight toolchains are vendored — the first run downloads them.
- The stack binds fixed localhost ports; they must be free and bindable: `5432` (PGLite), `8899`/`9900` (Solana), `9999` (sync API), `3334` (batcher), `3335` (operator), `5173` (frontend), plus `9944`/`8088`/`6300` when self-hosting Midnight.

## Running the stack

```bash
bun install
bun run dev            # local (undeployed)
bun run dev:preview    # against the preview TestNet   (see docs/networks-and-accounts.md)
bun run dev:preprod    # against the preprod TestNet
```

`bun run dev` brings the whole stack up in dependency order — Solana validator, a Midnight localnet, the compiled contract (deployed once), the sync node, the operator, the gasless batcher, and the frontend. It shows a live checklist as each service comes up and ends with a banner pointing at the app:

```
✓ anonboard is ready
  Open      http://localhost:5173  ← the app
  ...
```

It **holds the terminal** like any dev server; **Ctrl-C** stops the whole stack and frees the ports.

### Managing a running stack

| Command | What it does |
|---|---|
| `bun run dev:logs` | Follow the raw logs (they stream to `.dev.log`). |
| `bun run dev:status` | Show every service, its PID, ports, and links — works from any terminal. |
| `bun run dev:stop` | Stop everything and free the ports (reaps a localnet the orchestrator would otherwise leave). |
| `bun run dev:raw` | The plain orchestrator output, without the checklist wrapper. |

To wipe the local chain and start clean:

```bash
bun run --filter @solana-anonboard/contracts-midnight midnight:reset
```

## Headless scripts

The same flows without the UI:

- `scripts/demo.ts` — the full loop end-to-end.
- `scripts/blind-join.ts` — an operator-blind join (the payer never sees the member's secret).
- `scripts/gasless-post.ts` — a zero-SOL post via the batcher.

## Tests

```bash
bun run test          # full end-to-end suite (boots a localnet)
bun run test:unit     # node + database unit tests
bun run test:contract # the Compact contract simulator (incl. anonymity/bypass checks)
```

## Troubleshooting

- **`bun run dev` prints a "partial localnet" error and stops.** Leftover Midnight processes from a previous run are squatting `:9944`/`:8088`/`:6300`. Run `bun run dev:stop` to reap them, then retry. (Ctrl-C already does a full teardown; this happens after a hard kill or a closed terminal.)
- **The indexer logs a crash then recovers on a cold start.** Expected. The vendored indexer's stake-pool sub-indexer can exit once on a freshly-wiped chain; it's supervised and relaunches. Each `bun run dev` starts from a fresh chain, and an indexer connected from genesis rides epoch crossings fine.
- **The deploy sits at "Waiting to receive tokens…" for a minute or two.** Normal on a cold chain: the deploy wallet holds NIGHT but needs dust to accrue before it can pay. It resolves on its own.
- **A hosted (preview/preprod) run fails at the payment step.** The payer wallet isn't funded on that net — see [networks & accounts](networks-and-accounts.md#funding-the-payer-wallet-on-a-hosted-net).
- **The local Solana validator wedges after ~45 min.** The vendored validator can't cap its ledger size and eventually prunes blocks the sync still needs. A fresh `bun run dev` resets both chains to slot 0.
- **Lace fails to connect with "Network ID mismatch" on `undeployed`.** Every `bun run dev` boots a *fresh* local chain (new genesis), so a Lace wallet still bound to the previous localnet no longer matches the one the node reports. Disconnect the dApp in Lace and reconnect — or just reopen the browser tab — to re-bind to the new chain, then **Connect** works. (This only affects `undeployed`; hosted nets have a stable chain.)
