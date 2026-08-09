# Building an EffectStream + Midnight dApp: the investigation playbook

This is a reference trail. It documents how this repo (`anonboard-poc`) was
investigated and built: a dApp where a **private ZK proof on Midnight gates a
public action on another chain**, joined by one EffectStream state machine.

This repo pairs **Solana** with Midnight. If you are doing **Cardano**, read
[Part 0](#part-0--read-this-first-if-you-are-doing-cardano) first, because the
starting point is different in an important way.

The goal here is not "copy this app." It is "walk the same journey, faster,"
because the four bugs in [Part 5](#part-5--the-bugs-that-will-cost-you-a-day-each)
each cost a day to diagnose and they recur in any standalone build.

---

## Part 0 — Read this first if you are doing Cardano

**Cardano + Midnight already exists as a template: `zk-cardano`.** It does the
same shape this repo does (public state on the other chain, private ZK state on
Midnight). Solana was novel because *no* Solana+Midnight pairing existed;
Cardano is not novel in that way.

So your novelty cannot be "first Cardano+Midnight pairing." It has to be a real
improvement over `zk-cardano`. The opening is already documented in the
`zk-cardano` README itself: **its eligibility is not enforced in the circuit.**
It joins the two chains in the node's Postgres database and gates eligibility
with an HTTP endpoint, so a wallet that never qualified can still be accepted.
Its README literally says this is "the interesting exercise it stops short of."

That is your angle: **move the eligibility check from a database join into the
Compact circuit**, so the private proof is what makes the public action count,
enforced by the rollup rather than an API call. Everything else in this playbook
applies unchanged; you just swap the Solana leg for the Cardano leg
(`CARDANO_UTXORPC_PARALLEL` sync, YACI DevKit local devnet, the Cardano
primitives like `PrimitiveTypeCardanoPoolDelegation`).

Check the acceptance bar before you start: a submission that is "functionally a
copy of an existing template will not qualify." Extending `zk-cardano` is fine;
you just have to state what you added and why it is meaningfully different.

---

## Part 1 — What EffectStream is, in one picture

EffectStream (formerly Paima Engine) builds sovereign rollups. It reads state
from one or more L1s, folds every update into a single deterministic TypeScript
state machine, persists to Postgres, and serves it over REST + MQTT.

```
L1 chains ── sync protocols ──▶ deterministic state machine ──▶ Postgres ──▶ REST/MQTT
   ▲                            (generator transitions, replay-safe)
   └── batcher: the user signs off-chain, the batcher submits on-chain and pays the fees
```

Two facts that shape everything:

- **`disclose()` is the interface between ZK and the sync layer.** EffectStream
  reads Midnight's *public ledger*. Whatever a Compact circuit `disclose`s is
  exactly what the rollup can index — nothing more. A ledger field declared
  without `export` is invisible to the node. Designing the circuit *is*
  designing what the rollup is allowed to see. (In this repo: `badges` is
  exported and indexed; the `used` nullifier map is not exported, so the node
  cannot count or correlate joins.)
- **The batcher pays fees.** On both chains the user can sign for free and never
  hold a token; a sponsor/batcher pays. This is what makes the app walletless
  and gasless.

---

## Part 2 — The method: find the weak seam, then close it

The whole investigation was one question: **how do the existing Midnight
templates join their two chains, and where is that join weak?**

Answer, found by reading the templates: **all three Midnight pairings correlate
their chains in the node's Postgres database, not in the proof.** Two say so in
their own READMEs:

- `evm-midnight-v2`: the chains are correlated by "a shared key the user
  supplies to both sides." The user is the integrity boundary.
- `zk-cardano`: "eligibility is not proven in-circuit, a wallet that never
  delegated can still cast a vote that the contract accepts."

That is the seam. The contribution is to make the **private proof a
cryptographic precondition** for the public action, enforced in the rollup.

**How to run this method yourself:**

1. Clone `effectstream/effectstream` (branch `v-next`). Read the template whose
   pairing matches your chain (`zk-cardano` for Cardano).
2. Grep every `templates/*/packages/node/config.dev.ts` to see which chains pair
   with Midnight and how the sync protocols are wired.
3. Read that template's state-machine.ts. Find where the two chains are joined.
   It will be a Postgres upsert, not a circuit check. That gap is your project.
4. Read the template README's "what this stops short of" section. The authors
   usually name the opening for you.

---

## Part 3 — The architecture this repo implements

Prove once, privately. Act many times, publicly. The rollup enforces the link.

- **Midnight (private, once):** a Compact circuit (`packages/contracts-midnight/
  contract-anonboard/src/anonboard.compact`) checks a roster and burns a
  nullifier, so each member gets exactly one anonymous badge. The badge is a
  fresh public key on the other chain. `join` discloses only that key. Nothing
  records which member.
- **Other chain (public, many):** the badge key signs actions. Sponsored, so
  the user holds no token.
- **The arbiter (`packages/node/state-machine.ts`):** reads the badge set off
  Midnight's public ledger, reads actions from the other chain, and counts an
  action **only if its signer holds a badge**. That single `if` is the thing no
  existing template does.

Three files carry the whole idea: the `.compact` circuit, the other chain's
program/contract, and `state-machine.ts`.

---

## Part 4 — The verification harness (`scripts/`)

Each script proves one property by running it, not by arguing it. Read these in
order; they are the "did it actually work" trail.

| Script | Proves |
| --- | --- |
| `demo.ts` | the arbiter: a badge holder's action is accepted, a stranger's rejected |
| `blind-join.ts` | operator-blind join: a funded party pays + submits a locally-proven join and never sees the secret |
| `gasless-post.ts` | gasless: a 0-token user acts, the sponsor pays, balance unchanged |
| `read-state.ts` | ground truth: read the badge/roster maps straight from the contract ledger |
| `dedupe-midnight-wasm.ts` | the fix for bug #1 (runs as `postinstall`) |

`RESULT.md` records the final verified run (one 0-token user: blind join →
gasless action → accepted after the ordering backfill).

The pattern worth copying: **when you claim a property, write a script that
fails loudly if it is false.** "Operator-blind" is only real if a process that
never receives the secret can complete the action. So `blind-join.ts` is
literally two scopes sharing one hex string.

---

## Part 5 — The bugs that will cost you a day each

These are standalone-install bugs. The template monorepo hides them inside
`link.sh`; a standalone repo (which a real submission requires) does not. Fix them up
front.

### Bug 1 — duplicate Midnight WASM runtime → `expected instance of ChargedState`

`@effectstream/sync` depends on `"@midnight-ntwrk/onchain-runtime":
"npm:@midnight-ntwrk/onchain-runtime-v3@3.0.0"` while `compact-runtime` depends
on `onchain-runtime-v3` under its real name. Same package, two names → two
physical copies → two WASM instances → two distinct `StateValue` classes. The
generated contract reader does `x instanceof StateValue ? x : x.state`, so a
`StateValue` from the sync fetcher fails the check and throws a `ChargedState`
error that names nothing useful.

**Fix:** symlink the alias to the real package. See
`scripts/dedupe-midnight-wasm.ts`, wired as `"postinstall"` in `package.json` so
it survives every `bun install`.

### Bug 2 — `link.sh`-mode hardcoded `./node_modules` paths

Several template scripts hardcode `./node_modules/...`, but linked/standalone
installs hoist dependencies to the repo root, so scripts running from
`packages/<pkg>/` cannot find them. Seen in three places: forge remappings
(`--depth=0` must become `--depth=4`), `wait-on`, and the `npm-midnight-*`
binaries (need `../../` or `../../../../` prefixes). Symptom: "Module not found"
at boot.

**Fix:** point the paths at the actual hoisted location. Grep your scripts for
`./node_modules` and correct each.

### Bug 3 — `launchMidnight` export path

`launchMidnight` is exported as `@effectstream/orchestrator/launch-midnight`,
**not** `@effectstream/orchestrator/scripts/launch-midnight` (unlike
`launchSolana`, which *is* under `/scripts/`). Also, the Midnight deploy step
needs `MIDNIGHT_STORAGE_PASSWORD` (16 chars) passed via `launchMidnight`'s
`opts.env`. See `start.dev.ts`.

### Bug 4 — validator ledger pruning wedges a slow sync (Solana-specific; check the Cardano equivalent)

On a long-running localnet the validator prunes old blocks faster than a slow
`*_RPC_PARALLEL` sync consumes them, and the sync wedges on a pruned slot
("Block N cleaned up, does not exist on node"). `@effectstream/solana-node`'s
`run()` gives no way to raise `--limit-ledger-size`. A **fresh boot** resets
validator and sync to slot 0 together and they keep pace, which is the
workaround. For Cardano, check whether the YACI/Dolos devnet has the analogous
retention limit before a long session.

All four are legitimate **upstream issues** worth reporting to EffectStream —
they help every future builder, not just your submission.

---

## Part 6 — Midnight SDK call-shape gotchas (small, undocumented, real)

Found by running, not reading. If you call Compact circuits from a script:

- `findDeployedContract` takes `{ compiledContract }`, **not** `{ contract }`.
- Build the contract via `CompiledContract.make(name, Contract).pipe(
  CompiledContract.withWitnesses(w), CompiledContract.withCompiledFileAssets(
  managedDir))`, **not** `new X.Contract()`.
- Call `setNetworkId(id)` before **any** wallet or contract operation.
- The level private-state provider is scoped by contract address: call
  `provider.setContractAddress(addr)` before `.set(...)`.
- To read a Compact `Map` ledger field from the sync node, declare it in the
  primitive's `ledgerSchema` as `{ type: "map", value: <type> }`, with keys in
  **Compact declaration order** (see `packages/node/config.dev.ts`).

Neat trick used in `blind-join.ts`: you can compute a member's public key
**off-chain** with `persistentHash` from `@midnight-ntwrk/compact-runtime`,
matching the circuit's `pad(32, "prefix") ++ sk` exactly. Verify it against a
known on-chain value (e.g. the `owner`) before trusting it.

---

## Part 7 — The ordering issue you will hit (and its fix)

Midnight's sync catches up from block 1 at chain speed while the other chain is
already current. So a public action can be folded and judged **before** its
Midnight badge has synced, and get wrongly rejected.

**Fix (this repo, gap D):** don't drop it. When a badge lands, backfill any
earlier actions by that author that were rejected only for lack of a badge. See
`acceptPostsForAuthor` in `packages/database/sql/anonboard.ts`, called from the
badge transition in `packages/node/state-machine.ts`. Idempotent and
replay-safe. `evm-midnight-v2`'s README describes the same out-of-order problem.

---

## Part 8 — Versions and how to run it

Target the current support matrix (check
<https://docs.midnight.network/relnotes/support-matrix> before you start;
these are the versions this repo used):

- Compact compiler `0.31.x`, compact-runtime `0.16.0`, ledger-v8 `8.1.0`,
  midnight-js `4.1.1`, indexer `4.3.3`, proof-server `8.1.0`.
- Bun `>= 1.3` (older Bun predates the TC39 decorator runtime `@effectstream`
  relies on; symptom is a confusing `context.addInitializer is not a function`).

Run this repo:

    bun install                 # runs the WASM dedupe postinstall
    SKIP_SOLANA_BUILD=0 bun run --filter '*contracts*' build   # first time only
    NODE_ENV=development bunx orchestrator start                # brings up both chains + node
    MIDNIGHT_STORAGE_PASSWORD="YourPasswordMy1!" bun run scripts/demo.ts
    curl -s localhost:9999/api/posts | jq

The Midnight contract deploy is the slow step (cold-chain dust sync, a few
minutes). Wait for "Deployment successful" and the sync node on `:9999`.

---

## Part 9 — Checklist for the Cardano version

1. Read `zk-cardano` end to end. Note where it joins the chains in Postgres and
   where its README admits eligibility is not in-circuit.
2. Design the circuit so eligibility (Cardano stake / membership) is proven
   inside the Compact circuit, disclosing only a nullifier-bound entitlement.
3. Swap the sync leg: `CARDANO_UTXORPC_PARALLEL`, YACI DevKit devnet, the
   Cardano primitives.
4. Keep the arbiter pattern (Part 3) and the ordering backfill (Part 7).
5. Fix bugs 1–3 up front (Part 5); check the Cardano devnet's retention for the
   bug-4 analogue.
6. Write a script per property (Part 4). Do not claim a property you have not
   run.
7. State plainly what you extended from `zk-cardano` and how it differs. That is
   an acceptance requirement, not optional.
