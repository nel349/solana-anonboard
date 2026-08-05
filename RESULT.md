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
