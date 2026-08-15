# anonboard — how the whole system works

Internal reference. Gitignored. Read this first if you're new: it's the end-to-end
story of what anonboard does, on both chains, and how the pieces fit. It's the
"why and how," not the run instructions — for booting the stack see
`docs/internal/orchestration.md`; for the visual language see
`docs/internal/design/DESIGN-SYSTEM.md`.

---

## 1. What anonboard is

An **anonymous bulletin board** with a members-only door:

- **You must be a member to post** — but nobody, not even the people running the
  servers, can tell *which* member wrote *which* post.
- Membership is proven **privately on Midnight** (a zero-knowledge Compact
  circuit). Posting happens **publicly and gaslessly on Solana**.
- One **EffectStream** node watches both chains and **counts a post only if its
  author proved membership**.

The one-liner: *Midnight holds the right to speak; Solana holds the speech.*

Why two chains: Midnight is good at **private proofs** (prove "I'm a member"
without revealing who). Solana is good at **cheap, high-volume public writes**
(the posts). Neither chain alone does both well; anonboard puts each half where
it belongs and stitches them together off-chain.

Contrast with `example-bboard`: that can hide *who posted* but has no notion of
membership — any wallet can post, one message at a time. anonboard adds the
"are you allowed?" gate and moves the volume to Solana.

## 2. Is it functional right now?

**Yes — as a proof of concept, verified end-to-end on localnet** (browser-verified
2026-08-08; see `docs/internal/RESULT.md`). Mechanically, all four moving parts
work:

- A real Solana post program, gated by the arbiter. ✔
- Gasless posting — the author holds **zero SOL**; a sponsor pays. ✔
- Operator-blind join — the party that pays for and submits the join **never sees
  the member's secret**. ✔
- Cross-chain ordering handled — a post that arrives before its badge is held and
  **backfilled** to accepted once the badge syncs. ✔

Caveat on confidence: the **ported integration tests exist but haven't been run
green yet** (blocked by a localnet port conflict — see the task list). So "it was
demonstrated working" is stronger than "it's continuously test-verified." That's
a known gap, not a broken feature.

## 3. The cast (packages)

```
packages/
  contracts-midnight/   Compact "anonboard" contract — roster, badges, join circuit
  contracts-solana/     Solana program (dir "counter") — records posts as log lines
  node/                 EffectStream sync node — reads both chains, runs the ARBITER
  operator/             Midnight service — registers members, blind-submits joins
  batcher/              Solana fee-payer — co-signs + submits posts so users pay 0 SOL
  database/             PGLite schema + typed queries (badges, posts)
  frontend/             Vite + React UI — connect wallet, join, post, live feed
  tests/                Integration tests driving the real flow
```

Two chains, one off-chain brain:

```
        MIDNIGHT (private)                       SOLANA (public)
   ┌──────────────────────────┐          ┌──────────────────────────┐
   │  anonboard Compact contract│          │  post program (log lines) │
   │  roster / badges / nullifier│          │  ANONBOARD_POST|author|…  │
   └─────────────▲──────────────┘          └─────────────▲────────────┘
        owner add│    member join                 poster  │  gasless post
       (operator)│  (browser proves,              (browser │  via batcher
                 │   operator pays+submits)        signs)  │  (sponsor pays)
                 │                                         │
        badges map│ (public ledger)             program log │
                 │                                         │
                 ▼                                         ▼
        ┌───────────────────────────────────────────────────────┐
        │           EffectStream sync node (packages/node)         │
        │   reads Midnight badges  +  reads Solana post logs        │
        │   ARBITER: accept a post  ⇔  its author holds a badge     │
        │                 → Postgres (badges, posts)                │
        └───────────────────────────▲──────────────────────────────┘
                                     │ /api/posts, /api/badges
                                     ▼
                              frontend (live feed)
```

## 4. Mechanism 1 — Membership, on Midnight

The contract: `packages/contracts-midnight/contract-anonboard/src/anonboard.compact`.

Ledger fields:
- `owner: Bytes<32>` — set at deploy to `public_key(secret)`; the roster admin.
- `roster: Map<Bytes<32>, Boolean>` — **public**: who is allowed to become a member.
- `badges: Map<Bytes<32>, Boolean>` — **public**: anonymous badges. A badge is a
  **fresh Solana public key**. Each is bound to exactly one roster member, *with
  no record of which one*.
- `badge_count: Counter`.
- `used: Map<Bytes<32>, Boolean>` — **NOT exported**: the one-badge-per-member
  nullifier set. Because it isn't exported, the sync node (and everyone else)
  literally cannot read it.

Identity is derived, never stored raw:
- `witness private$secret_key()` — the member's secret, resolved **locally** at
  proving time; never leaves the prover, never in the transaction bytes.
- `public_key(sk) = persistentHash(["anonboard:pk:", sk])` — a member's public id.

The two circuits:
- `add_to_roster(member)` — asserts the caller is the owner
  (`public_key(secret) == owner`), then adds `member` (a public_key) to the roster.
  Run by the **operator** on the owner's behalf.
- `join(solana_pubkey)` — the heart of it. It:
  1. asserts `roster.member(public_key(sk))` — *you're on the roster*,
  2. computes `nullifier = persistentHash(["anonboard:nul:", sk])` and asserts
     `!used.member(nullifier)` — *you haven't joined before* (one-shot),
  3. inserts the nullifier into `used` — *burns it*,
  4. inserts `solana_pubkey` into `badges` — *publishes your anonymous badge*.

The result: a proof that "some roster member" bound this fresh Solana key as a
badge — with the member↔badge link unrecoverable, and no member able to mint two.

**Operator-blind join** (`scripts/blind-join.ts`, `packages/operator/operator.dev.ts`,
and `packages/frontend/src/midnight/join.ts`). Splitting proving from paying is
what makes "the operator never sees your secret" real:
- **Party A (the member / the browser)** holds the secret. It builds the `join`
  call, **proves it locally** (the witness is consumed by proving), and serializes
  an *unbound* transaction. The secret is not in those bytes.
- **Party B (the operator)** receives only the unbound hex + its own paying keys.
  It `balanceUnboundTransaction` + finalizes + submits — paying the Midnight fees
  (dust) — **without ever seeing the secret**.

## 5. Mechanism 2 — Posting, on Solana

The program: `packages/contracts-solana/programs/counter/src/lib.rs` (the dir is
historically named "counter"; it now also has the Post instruction).

- A `Post(body)` instruction emits one log line:
  `ANONBOARD_POST|<author>|<slot>|<body>` (body last, so it may contain `|`).
- Feeless by design: the transaction's **fee payer is a sponsor account**, and
  the program takes the rent payer as an explicit account, so the author signs
  **only their own authority** — which is free — and never needs SOL.

**The gasless batcher** (`packages/batcher/batcher.dev.ts`, `solana-adapter.ts`):
- The frontend builds the post tx with `feePayer = sponsor`, `partialSign`s it
  with the badge key, and POSTs the base64 tx + the user's signature to the
  batcher's `/send-input`.
- The batcher validates (fee payer must be the sponsor; every instruction must
  target the post program or a capped ComputeBudget), **co-signs as fee payer**,
  and submits. The author's balance is unchanged; the sponsor paid.

Note: the post carries the **badge's** Solana pubkey as author. That's the same
key the member published in `join`. So on Solana, the "author" is the anonymous
badge — not a wallet tied to a person.

## 6. Mechanism 3 — The arbiter (EffectStream)

The node: `packages/node/` — config in `config.dev.ts`, logic in
`state-machine.ts`, DB in `packages/database/`.

EffectStream runs an **NTP main clock** and two **parallel** sync protocols
merged into each main block:
- `SOLANA_RPC_PARALLEL` — polls the validator; the `SOLANA:ProgramLog` primitive
  surfaces only the post program's *own* log lines (it walks the
  invoke/success framing, so another program can't spoof them) as
  `solana-post` inputs.
- `MIDNIGHT_PARALLEL` — polls the indexer; the `MidnightGeneric` primitive reads
  the contract's public ledger (`owner`/`roster`/`badges`/`badge_count` — note
  `used` is deliberately absent, it isn't exported) as `midnight-badges` inputs.

Two state transitions (`state-machine.ts`):
- `midnight-badges` — mirrors each new badge from Midnight into the Postgres
  `badges` table (converting Midnight's hex to Solana base58), then **backfills**:
  any earlier post by that author that was rejected only for lack of a badge is
  flipped to accepted.
- `solana-post` — **the arbiter**. For each post log: look up the author in
  `badges`; write a `posts` row with `accepted = (author has a badge)` and a
  `reason`. The cross-chain link is a **proof result the node computed**, not a
  value the user handed to both sides.

Reason strings (also the contract of the tests):
- rejected → `accepted=false`, `reason='no midnight badge'`
- accepted later → `accepted=true`, `reason='badge verified (backfilled)'`
- accepted directly → `accepted=true`, `reason='badge verified on midnight'`

## 7. End-to-end walkthrough (one real user)

1. **Stranger posts.** A fresh badge key (0 SOL) posts via the batcher. Solana
   logs `ANONBOARD_POST|…`. The node's arbiter finds no badge → `posts` row
   `accepted=false, reason='no midnight badge'`. The UI shows "not a member."
2. **They join.** The operator `add_to_roster`s their membership key (owner
   action). The browser proves `join(badge)` locally (secret stays put); the
   operator balances+submits it blind. Midnight's `badges` map gains the badge.
3. **The badge syncs.** `MIDNIGHT_PARALLEL` sees it → `midnight-badges` inserts it
   into the `badges` table → the backfill flips the earlier post to
   `accepted=true, reason='badge verified (backfilled)'`. The UI turns green.
4. **They post again.** New post → arbiter finds the badge → `accepted=true,
   reason='badge verified on midnight'` immediately.

Throughout, the author pays 0 SOL (sponsor pays on Solana; operator pays on
Midnight), and no one can tie the badge to the roster member.

## 8. Privacy model — what's hidden and why

- **Who is a member** is *not* secret (`roster` is public — "norm is a
  contributor" is fine). **What a specific member posts** is the secret.
- A **badge** is a throwaway Solana key. `join` publishes the badge but binds it
  to "some member," never to *which* member.
- The **nullifier map (`used`) is not exported.** This is the crux: it enforces
  one-badge-per-member *inside the circuit*, but because it's unexported, the sync
  node can't read it and therefore can't count or correlate joins. In Compact,
  what a circuit exports is exactly what the rollup gets to see — so unexporting
  is a real privacy boundary, not an obfuscation.
- The member's **secret** never leaves the prover (witness), and the
  operator-blind flow means even the party paying/submitting the join never sees
  it.

## 9. The ordering caveat (worth understanding early)

Midnight's sync starts from block 1 and catches up at chain speed, while Solana
is already at its tip. So a member's **post can arrive before their badge** does.
The arbiter doesn't drop it — it records it rejected, and the `midnight-badges`
backfill promotes it to accepted when the badge lands (idempotent, replay-safe;
`acceptPostsForAuthor` in `packages/database/sql/anonboard.ts`). This is the one
place the two chains' clocks visibly disagree, and the design absorbs it rather
than pretending it can't happen.

## 10. Data model + API

Postgres (PGLite, in-memory; rebuilt each boot):
- `badges(pubkey, block_height)` — mirrored from Midnight.
- `posts(id, author, body, slot, block_height, accepted, reason)` — from Solana,
  judged by the arbiter.

HTTP (read-only, `packages/node/api.ts`): `GET /api/posts`, `GET /api/badges`.
The DB is written **only** by the state machine, never by the API — so a replay
of the chains reproduces the DB exactly.

The frontend (`packages/frontend/src/App.tsx`) polls both endpoints (~500ms),
shows member/not-member and accepted/rejected, connects Lace/1AM to join, and
posts optimistically (shows the post in ~50ms, reconciles from the feed).

## 11. Running it

One command brings the whole stack up in dependency order:
`bun run dev` (Solana validator, Midnight localnet + contract deploy, sync,
operator, batcher, frontend on :5173). The full launcher story, ports, and the
"attach to an existing localnet" refactor are in
`docs/internal/orchestration.md`.

## 12. Where to look (file map)

| Concern | File |
|---|---|
| Membership circuit | `contracts-midnight/contract-anonboard/src/anonboard.compact` |
| Deploy | `contracts-midnight/deploy.ts` |
| Solana post program | `contracts-solana/programs/counter/src/lib.rs` |
| Post instruction builder | `contracts-solana/src/instructions.ts` |
| Sync config (chains, primitives) | `node/config.dev.ts` |
| **Arbiter + badge mirror** | `node/state-machine.ts` |
| Read API | `node/api.ts` |
| Gasless fee-payer | `batcher/batcher.dev.ts`, `batcher/solana-adapter.ts` |
| Operator (register + blind submit) | `operator/operator.dev.ts` |
| Browser join (prove locally) | `frontend/src/midnight/join.ts` |
| DB schema + queries | `database/migrations/*.sql`, `database/sql/anonboard.ts` |
| Headless flow scripts | `scripts/blind-join.ts`, `scripts/gasless-post.ts`, `scripts/demo.ts` |

## 13. What's PoC-grade (so you don't mistake it for production)

- Dev trust: a single funded operator wallet, permissive CORS, no auth.
- The membership secret is kept in the browser's `localStorage` for the demo —
  a real build must encrypt it.
- The Solana program dir is still named "counter" (fork lineage); it carries the
  Post instruction anyway.
- The local validator can't cap its ledger size, so a long-running localnet
  eventually prunes blocks the sync still needs and wedges; a fresh `bun run dev`
  resets both to slot 0.
- Integration tests are written but not yet run green (localnet port conflict).

These are deliberate PoC shortcuts, not architectural constraints — the
membership/arbiter/gasless mechanics above are the real, working core.
