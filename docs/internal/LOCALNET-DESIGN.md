# Localnet — smart self-host / attach design

Internal. Proposed design (for buy-in before implementing). Companion to
`orchestration.md`, which describes the *current* (naive) mechanism and why it
crashes an existing localnet.

## Goal

`bun run dev` (and `bun run test`) should be **zero-config and safe**:

- **Nothing running → start everything** (the whole localnet), exactly as today.
- **Something already running → attach to it, never kill it.**
- **Something on the ports but broken/incompatible → stop with a clear message**,
  never a silent `kill`.

No flags required for the common cases; overrides exist for the rare ones.

## Scope — only Midnight is shared

| Service | Ports | Shared? | Policy |
|---|---|---|---|
| PGLite | 5432 | No (in-memory, per-process) | always self-host |
| Solana validator | 8899 / 9900 | No (anonboard's own; must load our program at boot) | always self-host |
| **Midnight node / indexer / proof** | **9944 / 8088 / 6300** | **Yes — the wallet-cli localnet** | **detect → attach or self-host** |

So the smart logic is **only** for the Midnight group. Solana + PGLite keep
self-hosting (reclaiming *our own* orphan on 8899 is safe — nobody else uses it).

## The probe (health + identity, not "port is open")

Before the orchestrator builds its process list, run a **preflight probe** of the
Midnight group. A port being open is not enough — it could be a half-dead orphan
or a *different* chain. Probe all three and classify:

- **node (9944)** — Substrate JSON-RPC `system_health` (alive?) + `chain_getBlockHash(0)`
  (genesis hash = which chain) + `system_chain`/network id.
- **indexer (8088)** — a trivial GraphQL health query (is it up and indexing this node?).
- **proof server (6300)** — its readiness endpoint.

Classification (whole group):

| State | Meaning | Action |
|---|---|---|
| **ABSENT** | all three ports free | **SELF-HOST** — boot node(dev-spec)+indexer+proof+deploy, as today |
| **HEALTHY + COMPATIBLE** | all three healthy, network id = `undeployed`, generation matches | **ATTACH** — skip the three boot processes; deploy + fund on the running chain |
| **INCOMPATIBLE** | healthy, but wrong network id / generation | **NOTIFY + ASK** — say what's running vs what anonboard needs, then offer to start the correct localnet (stopping the running one **only** on an explicit "yes"). Non-interactive → abort with the message. |
| **PARTIAL / UNHEALTHY** | some ports up, or unresponsive | **NOTIFY + ASK** — offer to reclaim the stuck bits and start fresh, only with consent. Non-interactive → abort. |

"Compatible" matters: attaching to a *different* network id (e.g. `preview` on the
same ports) would break address formats (HRP mismatch) and dust — so a mismatch is
never a silent attach.

## Never kill — replace the hammer

Today each Midnight boot process carries `stopProcessAtPort`, which `lsof + kill`s
whatever holds 9944/8088/6300 (including the Docker port-proxy of a running
localnet), at both launch and shutdown. **Remove `stopProcessAtPort` from the
Midnight group entirely.** Force-freeing a shared port is the bug. In SELF-HOST
mode the ports are already free (that's why we chose it); in ATTACH mode we don't
boot those processes at all. The **only** time we stop something on those ports is
the incompatible/partial case above — and only after the dev says "yes, start the
correct one for me."

## The real work: funding on attach — via the `mn` CLI

Self-host is easy — the committed `dev-spec.json` genesis funds the deploy wallet
automatically. **Attach's one hard part is funding**, because the running localnet
is a *different chain* that funds *its own* wallet, not anonboard's deploy seed.

Rather than reimplement Midnight wallet ops, **add `midnight-wallet-cli` (`mn`) as
a devDependency** and let it do the work — it already has airdrop, dust
registration, balance, and transfer, all tested. (Solana already funds its side
this way via the `airdrop-batcher` step; this gives Midnight the same treatment.)

ATTACH-mode fund preflight:
1. Derive the deploy wallet's Midnight address from its seed.
2. `mn airdrop` NIGHT to it + register dust on the attached chain (idempotent —
   skip if already funded).
3. Run the (idempotent) contract deploy and proceed.

Exactly the sequence we did by hand earlier (airdrop 10000 NIGHT + register dust),
now automated through the CLI.

Packaging note: `mn` is only needed for the **attach** convenience path — the
default **self-host** path (fresh clone, no localnet) needs none of it. For the
public example we either (a) publish `mn` to npm and pin it as a devDependency, or
(b) invoke `mn` if present and otherwise fall back to "set a funded
`MIDNIGHT_WALLET_SEED`," so the example never hard-fails on a private package.

## Where it lives

- A small **`localnet-preflight`** module (bun) that does the probe + classify and
  returns a plan: `{ midnight: "self-host" | "attach", reason }`.
- `start.dev.ts` / `start.test.ts` call it at config-build time and **conditionally
  include** the Midnight boot processes:
  - self-host → spread the node/indexer/proof/deploy processes (no `stopProcessAtPort`).
  - attach → include only `midnight-contract-compile` + a **fund-then-deploy**
    process; downstream (`sync`, `operator`, `frontend`) keep depending on the
    `midnight-contract` name, so nothing else changes.
- The app layer already reads `midnightNetworkConfig` (env-overridable, defaults to
  9944/8088/6300), so ATTACH needs no URL changes for the standard `undeployed` case.

## Overrides (rare cases)

- `MIDNIGHT_LOCALNET=self|attach|auto` (default `auto`) — force a mode; `self`
  answers "yes, start one" without prompting.
- Non-interactive / CI — no prompt; default to abort on incompatible/partial
  unless a mode is forced.
- Existing `MIDNIGHT_*` URL/seed env vars still repoint to a hosted chain.

## Failure modes → clear messages

- Ports free → "No localnet detected — starting a fresh one."
- Healthy + compatible → "Attaching to the localnet already on 9944/8088/6300."
- Wrong network id → "A `preview` chain is on these ports; anonboard needs
  `undeployed`. Stop it or set MIDNIGHT_* to a compatible chain."
- Partial/unhealthy → "Port 8088 is occupied but the indexer isn't responding.
  Free it, or re-run with --reclaim."
- Attach but unfundable → "Deploy wallet has no funds on the attached chain and it
  has no faucet — set MIDNIGHT_WALLET_SEED to a funded seed."

## Why this is the right shape

- **Safe by default** — it can't kill a running localnet because it never force-frees
  a shared port; it either attaches or refuses.
- **Zero-config** — `auto` detection covers both "fresh machine" and "localnet
  already up" without the developer thinking about it.
- **Honest** — ABORT-with-a-message beats a silent kill or a confusing half-boot.
- **Small blast radius** — only the Midnight group changes; Solana/PGLite untouched.
- **Testable** — the same preflight lets `bun run test` attach to a running localnet
  (the current blocker), so tests stop fighting the dev localnet.

## Decisions (settled)

1. **Compatibility is required.** Auto-attach only to a healthy `undeployed`
   Midnight localnet at the versions anonboard targets; anything else = incompatible.
2. **Incompatible / partial → notify + ask, never silent.** Say what's running vs
   what anonboard needs, then offer to start the correct localnet — stopping the
   running one only on an explicit "yes." CI defaults to abort.
3. **Fund on attach via `mn`.** Add `midnight-wallet-cli` as a devDependency and
   have it airdrop + register dust to the deploy wallet before deploy.

## Implementation notes

- The `mn` CLI is this repo's sibling project (`midnight-wallet-cli`). Confirm how
  to reference it as a devDependency (npm if published, else git/file) as step one.
- The interactive prompt lives in the `localnet-preflight` module (Node `readline`),
  run before the orchestrator builds its process list; TTY-aware (skips in CI).
- Keep the compatibility probe cheap and specific (network id + a version/genesis
  signal) so a false "compatible" can't slip an incompatible chain through.
