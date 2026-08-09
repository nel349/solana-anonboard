# PoC result — verified 2026-08-04

Solana + Midnight in one EffectStream node, where a private ZK proof on
Midnight gates a public action on Solana.

## Observed

    id=1  bh=78   accepted=false  CzHwDZ86…  no midnight badge
    id=2  bh=79   accepted=false  DomViusS1…  no midnight badge
    id=3  bh=150  accepted=true   CzHwDZ86…  badge verified on midnight
    id=4  bh=151  accepted=false  7aM2vTui…  no midnight badge

Same Solana program, same instant. id=3 is a key that proved roster membership
in a Compact circuit; id=4 never joined. ids 1 and 3 are the SAME key — the
only difference is whether the badge had finished syncing, which is the
ordering caveat below.

## What that proves

- The Compact circuit proves roster membership and burns a nullifier, so one
  member gets exactly one badge (rerun logs "reusing badge … already joined").
- `join` discloses only a Solana public key. Nothing records which member.
- EffectStream reads the `badges` map off Midnight's public ledger and mirrors
  it into Postgres. The `used` nullifier map is NOT exported, so the sync node
  cannot read it — verified absent from the generated `Ledger` type.
- The state machine counts a Solana post only if its signer holds a badge.
  The link between chains is a proof result, not a user-supplied key.

## Known issue to fix in the real build

Midnight's sync catches up from block 1 at chain speed while Solana is already
current, so a post can be folded and judged before its badge arrives (ids 1
and 2 above). `evm-midnight-v2`'s README describes the same out-of-order
problem; the fix is a placeholder row plus `ON CONFLICT … DO UPDATE`, plus
re-evaluating pending posts when a badge lands.

## Run it

    bun install
    SKIP_SOLANA_BUILD=1 NODE_ENV=development bunx orchestrator start
    MIDNIGHT_STORAGE_PASSWORD="YourPasswordMy1!" bun run scripts/demo.ts
    curl -s localhost:9999/api/posts | jq

## Update — all gaps closed and verified (2026-08-04)

Single fresh-chain run, one 0-SOL user, end to end:

    1. blind-join: poster GQKsPui4… gets a badge, holds 0 SOL      [operator paid Midnight]
    2. gasless post: batcher accepted (tx 3or37oFfk5hv…)
       poster SOL before 0 → after 0                               [sponsor paid Solana]
    3. FINAL: accepted=true, reason='badge verified (backfilled)'
       body='gasless: i hold zero SOL and still posted'
       poster SOL still 0

- Gap A: real Solana post program, message gated by the arbiter. Verified.
- Gap B: gasless — author balance unchanged, batcher/sponsor paid. Verified.
- Gap C: operator-blind join — party B paid+submitted, never saw the secret;
  badge landed. Verified.
- Gap D: ordering — the post arrived before the badge, was held, then backfilled
  to accepted when the badge synced. Verified (reason string proves the path).

## Finding #4 (infra, reportable)

@effectstream/solana-node's run() cannot pass --limit-ledger-size, so on a
long-running localnet the validator prunes blocks faster than a slow
SOLANA_RPC_PARALLEL sync consumes them; the sync then wedges on a pruned slot
("Block N cleaned up, does not exist on node"). A fresh boot resets validator
and sync to slot 0 together and they keep pace. Fixes: expose extraArgs /
ledger-size in run(), or start the Solana sync near the tip, or raise retention.

## Update — browser-verified end to end (2026-08-08)

The full loop now runs through a real React frontend (packages/frontend),
verified live in Chrome:

1. A browser user with ZERO SOL generated an anonymous badge and posted
   "hello from a browser with zero SOL" gaslessly (the batcher paid).
2. The arbiter rejected it live: the board showed "not verified · no midnight
   badge" (red).
3. The operator blind-joined that browser badge on Midnight (BADGE_PUBKEY);
   party B paid and submitted, never seeing the membership secret.
4. The badge synced, the gap-D backfill flipped the post to accepted, and the
   browser UI updated itself: badge → "verified member" (green), post →
   "verified member · badge verified (backfilled)".

Frontend: Vite + React, adapted from the inherited solana-starter frontend;
gasless post via the batcher; live feed + membership from /api/posts and
/api/badges. Builds clean (vite build, 116 modules).
