# Development

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.3. No Docker required (the localnet runs native vendored binaries). The Solana and Midnight node/indexer/proof toolchains are vendored; the **first run compiles the Rust Solana program + the Compact circuit and downloads the toolchains, so expect a few minutes.**
- The **Compact compiler** (NOT vendored, and the compiled `managed/` artifact is not committed, so a fresh clone must have it). Install: `curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh`. The boot step compiles with toolchain `+0.31.0`, which the installed `compact` version manager fetches on first use.
- `midnight-wallet-cli` (`mn`) **≥ 0.5.0**, installed automatically from the pinned dependency. The deploy and operator prime dust via `mn dust export`, which exists only in 0.5.0+; on 0.4.x it is missing and the flow falls back to the slow SDK cold-sync that never completes on preprod. Check with `mn --version`.
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

## Why dust is primed via `mn` (and the two SDK workarounds)

Spending anything on Midnight — deploying the contract, `add_to_roster`, paying a join fee — costs **dust**, and a wallet can only spend once its dust sub-wallet has **synced** to the chain's current dust state. The wallet SDK's built-in sync does this by replaying the whole dust-event history from scratch. On a hosted TestNet that history is large (preprod is ~1.4M events); the cold sync takes many minutes and, in practice, **never completed on preprod** — the deploy wallet ended up with no usable dust and every spend failed with `Wallet.InsufficientFunds: could not balance dust`. Before this was wired, **preprod could not deploy at all**: the deploy died at fee-balancing and the whole stack aborted.

**The fix — prime the dust, don't cold-sync it.** Instead of letting the SDK crawl from genesis, we ask the [`midnight-wallet-cli`](https://github.com/nel349/midnight-wallet-cli) (`mn`) to produce a dust **snapshot** the fast way (`mn dust export` — an indexer-direct reader that only touches *our* wallet's events, ~5–9 s), then hand that snapshot to the wallet at construction time via the SDK's own supported parameter:

```ts
const snapshot = await primeDustSnapshotViaMn(networkId, seed);   // ~5–9 s
const wallet   = await buildWalletFacade(urls, seed, id, "all", snapshot); // 5th arg = dustSerializedState
await syncAndWaitForFunds(wallet.wallet, { skipShielded: true }); // catches up the tiny delta
```

The snapshot is SDK-native (`DustLocalState.serialize()` from the same `ledger-v8`), so this is a **warm-up, not a bypass** — the wallet starts already-synced instead of cold. Every actual contract interaction (deploy, `add_to_roster`, join proving, balancing, submitting, reading state) still runs on the **unmodified Midnight SDK**. The priming lives in one shared helper (`packages/contracts-midnight/mn-dust-prime.ts`) called from the three wallets that spend dust — the operator, the deploy (`deploy.ts`), and the headless join (`scripts/blind-join.ts`). If `mn` isn't available it **falls back** to the SDK cold-sync, so nothing breaks; it's just slow again on hosted nets.

There are **two** SDK workarounds, and they age differently:

| Workaround | What it is | Remove when |
|---|---|---|
| **Dust priming** (`mn-dust-prime.ts`) | A speed warm-up using the SDK's supported `dustSerializedState`. Isolated behind `try { prime } catch { SDK cold-sync }`. | Midnight's own dust sync is fast/reliable on hosted nets — then delete the `try` branch; the SDK path is already underneath. |
| **`dust-revert-patch.ts`** (operator) | A **monkey-patch of the SDK's `CoreWallet`** fixing a real SDK bug: a *rejected* transaction's revert destroys the dust UTXO instead of restoring it (surfaced as `InsufficientFunds` on the next write). Reaches into SDK internals. | The SDK fixes its revert. The file has a "remove when fixed" note and the tests detect when it's no longer needed. This is the one to re-check on every SDK upgrade. |

So the running system is **"SDK everywhere; `mn` only warms the dust,"** and both workarounds are written to be lifted cleanly once upstream catches up.

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
- **A browser wallet won't connect on `undeployed`.** There is no browser-wallet path on the local network: Lace does not support `undeployed` at all ([lace#2254](https://github.com/input-output-hk/lace/issues/2254)), and 1AM breaks when you switch between `undeployed` and a hosted net (upstream, fix pending). For a local demo use the headless flow (`bun run scripts/demo.ts` or `scripts/blind-join.ts`); to use the browser UI, run against a hosted net (`bun run dev:preview`) with a supported wallet. On a hosted net, if the wallet reports a stale "Network ID mismatch", disconnect the dApp and reconnect (or reopen the tab) to re-bind.
