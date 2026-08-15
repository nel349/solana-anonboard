# Orchestration — how the dev/test stack runs, and why it fights your localnet

Internal notes. Gitignored. The goal: understand exactly what `bun run dev` and
`bun run test` start, why they kill an already-running Midnight localnet, and
what a cleaner "attach to an existing localnet" design looks like.

## TL;DR

- `bun run dev` doesn't run one program. It runs an **orchestrator** that boots
  ~15 processes in dependency order — Postgres, a Solana validator, a **full
  Midnight localnet (node + indexer + proof server)**, the contract deploy, then
  our own services (sync, operator, batcher, frontend).
- The Midnight node/indexer/proof here are **vendored npm binaries**, not Docker
  — but they bind the **same ports** as your wallet-cli Docker localnet:
  **9944 / 8088 / 6300**.
- Each of those three processes carries `stopProcessAtPort`. Before it starts,
  the orchestrator **kills whatever is listening on that port** — which is the
  Docker port-mapping for your running localnet. That's the crash. It happens
  again on shutdown.
- **The app layer never boots a localnet.** The sync node, operator, deploy, and
  tests all just *connect* to URLs from one config object (`midnightNetworkConfig`),
  and those URLs already default to `9944/8088/6300`. So "attach to an existing
  localnet" = **stop booting our own Midnight node/indexer/proof; keep everything
  else.** The only real work is funding the deploy wallet on the external chain.

## What `bun run dev` actually is

```
bun run dev
  → NODE_ENV=development bunx orchestrator start        (root package.json)
    → @effectstream/orchestrator reads effectstream.default = start.dev.ts
      → start.dev.ts exports a process list; the orchestrator runs it
```

`start.dev.ts` builds that list from three helpers imported from the
orchestrator: `launchPglite()`, `launchSolana()`, `launchMidnight()` — each
returns a group of process configs — plus our own app processes. `bun run test`
uses `packages/tests/start.test.ts`, the same helpers minus the operator/frontend.

A "process config" is just `{ name, args, cwd?, dependsOn?, waitToExit?,
stopProcessAtPort?, ... }`. The orchestrator launches in **waves**: everything
whose dependencies are satisfied starts together; a `waitToExit` dependency must
finish (exit 0) before its dependents start.

## The full process map

Grouped as the helpers group them. Ports in **bold** are the ones with
`stopProcessAtPort` (the orchestrator will free/kill them).

### Postgres — `launchPglite()`
| process | what it runs | port | waits on |
|---|---|---|---|
| `pglite` | in-memory Postgres | **5432** | — |
| `pglite-wait` | tcp wait on 5432 | — | pglite |

### Solana — `launchSolana(@solana-anonboard/node)`
| process | what it runs | port | waits on |
|---|---|---|---|
| `build-counter` | compiles the Solana program `.so` | — | — |
| `solana-validator` | local `solana-test-validator` | **8899, 9900** | build-counter |
| `solana-validator-wait` | tcp wait on 8899 | — | solana-validator |

### Midnight localnet — `launchMidnight(@solana-anonboard/contracts-midnight)`
This is the group that fights your localnet. It runs the scripts in
`packages/contracts-midnight/package.json`.
| process | what it runs | port | waits on |
|---|---|---|---|
| `midnight-contract-compile` | `compact` compile of the circuit | — | — |
| `midnight-node` | vendored `npm-midnight-node` (funded `dev-spec.json` genesis) | **9944, 30333** | — |
| `midnight-indexer` | vendored `npm-midnight-indexer` | **8088** | midnight-node |
| `midnight-proof-server` | vendored `npm-midnight-proof-server` | **6300** | midnight-node |
| `midnight-node-wait` / `-indexer-wait` / `-proof-server-wait` | tcp waits | — | their start proc |
| `midnight-contract` | `deploy.ts` — deploys the contract, writes `contract-anonboard.undeployed.json` | — | the three waits + compile |

### Our services — defined in `start.dev.ts`
| process | what it runs | port | waits on |
|---|---|---|---|
| `sync` | the EffectStream sync node (`packages/node/main.dev.ts`) | — | pglite-wait, solana-validator-wait, **midnight-contract** |
| `operator` | roster registrar + blind-join fee-payer | **3335** | **midnight-contract** |
| `airdrop-batcher` | airdrops SOL to the batcher wallet | — | solana-validator-wait |
| `batcher` | gasless Solana fee-payer | **3334** | airdrop-batcher |
| `frontend` | Vite + React UI | **5173** | batcher, **midnight-contract** |

## Two roles: who boots the localnet vs who connects to it

This is the key distinction for the refactor.

- **Booting** the Midnight localnet is done by exactly three processes:
  `midnight-node`, `midnight-indexer`, `midnight-proof-server`. Nothing else
  starts a chain. They exist only in the `launchMidnight` group.
- **Connecting** to it is done by everyone else — deploy, the sync node
  (`config.dev.ts`), the operator, and the tests — through **one config object**:
  `midnightNetworkConfig` (from `@effectstream/midnight-contracts/midnight-env`).
  It exposes `node` (9944), `indexer` (8088), `proofServer` (6300), an
  `indexerWS`, a network `id`, and a `walletSeed`. **Every field is
  env-overridable** (`MIDNIGHT_NODE_HTTP`, `MIDNIGHT_INDEXER_HTTP`,
  `MIDNIGHT_INDEXER_WS`, `MIDNIGHT_PROOF_SERVER_URL`, `MIDNIGHT_NETWORK_ID`,
  `MIDNIGHT_WALLET_SEED`/`MIDNIGHT_WALLET_MNEMONIC`), and the defaults **already
  point at 9944/8088/6300** for the `undeployed` network.

So the app layer is already localnet-agnostic. Only the launcher hard-codes
"boot our own."

## Why it crashes your running localnet

`stopProcessAtPort: [p]` means: **before launching this process, kill whatever is
listening on port `p`** — and do it again for every declared port on shutdown.
Mechanically the orchestrator runs `lsof -ti tcp:<p> -sTCP:LISTEN` then
`kill -TERM` (then `-KILL` after ~5s).

Your wallet-cli localnet publishes 9944/8088/6300 on the host through Docker's
port proxy. When `bun run dev` goes to launch `midnight-node`
(`stopProcessAtPort: [9944, 30333]`), it finds *that host listener* — the Docker
proxy — and kills it. Same for indexer (8088) and proof (6300). The published
port mappings drop, your localnet is knocked off those ports, and the
orchestrator boots its own vendored node/indexer/proof in the gap. On Ctrl-C the
shutdown loop frees every configured port again, a second hit.

It isn't malicious or specific to Docker — `stopProcessAtPort` is a "make sure
the port is free for me" hammer, and it can't tell your localnet from a stale
orphan of its own.

## The seam: attach to an existing localnet

`launchMidnight` has **no skip switch** — it always returns all seven processes.
But it returns a plain array, so we don't have to use it. To attach:

1. **Don't boot our own node/indexer/proof.** Drop `midnight-node`,
   `midnight-indexer`, `midnight-proof-server` from the launcher. That alone
   removes every `stopProcessAtPort` for 9944/30333/8088/6300 — those ports live
   *only* on those three configs — so a running localnet is never touched.
   (Don't just delete `stopProcessAtPort` and keep the start scripts; they'd
   still try to bind the ports and collide.)
2. **Keep the deploy.** Everything downstream (`sync`, `operator`, `frontend`)
   depends on the process named `midnight-contract`. Keep that name and its
   deploy command; point its `dependsOn` at just `midnight-contract-compile`
   (the tcp-wait processes go away with the nodes).
3. **Point config at the chain (usually nothing to do).** If the external
   localnet is the standard `undeployed` on 9944/8088/6300, the defaults already
   match. Otherwise set the `MIDNIGHT_*` env vars.
4. **Fund the deploy wallet — the one real gotcha.** `deploy.ts` builds a wallet
   from `walletSeed` (default genesis seed `0000…0001`) and **blocks until it has
   shielded funds**. That seed is only funded because *our* node boots from
   `dev-spec.json`, whose genesis funds it. A different localnet (yours) has a
   different genesis and almost certainly funds a different seed. So on an
   external chain you must either point `MIDNIGHT_WALLET_SEED` at a seed that
   chain funds (and give it NIGHT + dust), or fund `0000…0001` on that chain
   first. `MIDNIGHT_SKIP_WAIT_FOR_FUNDS=true` only skips the *wait*, not the need
   for funds — the deploy tx still fails without balance/dust. Also watch the
   network-id / address HRP: it must match the external chain.

Net: the code change is small (drop three processes, keep the deploy node).
The substance is **funding the deploy wallet on the external chain** — the one
thing our self-booted node was silently providing.

## Restructuring options

Framed as choices, not a chosen design:

- **Minimal, env-gated attach.** Add a `MIDNIGHT_EXTERNAL=1` (or
  `MIDNIGHT_ATTACH`) switch. When set, the launcher builds the Midnight leg as
  just `{ compile, deploy }` against `midnightNetworkConfig`; when unset, it
  self-hosts as today. One `if` in `start.dev.ts` / `start.test.ts`. Smallest
  change; keeps the self-contained `bun run dev` default and lets tests/CI point
  at an existing chain.
- **A "midnight backend" abstraction.** Replace the raw `launchMidnight(...)`
  spread with a local helper `midnightLeg({ mode: "self-host" | "attach" })` that
  returns the right process set. Reads cleaner, documents the two modes, and is
  the natural home if we later add a third mode (hosted testnet).
- **Split the launcher entirely.** A `start.self.ts` (self-hosted, the demo
  experience) and a `start.attach.ts` (deploy + app only, for an existing
  localnet / CI). Most explicit, most duplication.

Whichever we pick, the funding step is the same design question: for `attach`
mode we need a documented, scripted way to fund the deploy seed on the target
chain (an airdrop/transfer helper, or a required `MIDNIGHT_WALLET_SEED` that's
known-funded), because the app can't proceed without it.

## For the test suite specifically

`bun run test` has the same collision (its `start.test.ts` uses the same
`launchMidnight`). The clean way to run the ported anonboard tests against a
running localnet is the **attach** path above: drop the three self-boot
processes from `start.test.ts`, keep the `midnight-contract` deploy, and make
sure the deploy wallet is funded on that chain. Then the test stack uses the live
node/indexer/proof and never frees (kills) 9944/8088/6300.
