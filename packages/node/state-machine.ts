import { Stm } from "@effectstream/sm";
import type { BaseStfInput } from "@effectstream/sm";
import type { StartConfigGameStateTransitions } from "@effectstream/runtime";
import { type SyncStateUpdateStream, World } from "@effectstream/coroutine";
import {
  acceptPostsForAuthor,
  getBadge,
  insertBadge,
  insertPost,
  REASON_BADGE_VERIFIED,
  REASON_NO_BADGE,
} from "@solana-anonboard/database";
import { grammar } from "./grammar.ts";
import { POST_PROGRAM_ID } from "@solana-anonboard/contracts-solana/program-id";
// Pure parsers live in log-parse.ts (unit-tested in test/log-parse.test.ts).
import { hexToBase58, parsePostLog } from "./log-parse.ts";

const stm = new Stm<typeof grammar, {}>(grammar);

// ── Private leg: mirror Midnight's badge set into Postgres ──
//
// A row in `badges` means: someone on the roster proved membership and bound
// this Solana key. Which roster member, nobody knows. The nullifier map that
// enforces one-badge-per-person is NOT exported by the contract, so it never
// reaches this process at all.
stm.addStateTransition("midnight-badges", function* (data) {
  const { parsedInput, blockHeight } = data;
  const payload = (parsedInput as any).payload as
    | { badges?: Record<string, boolean> }
    | undefined;

  const badges = payload?.badges ?? {};
  for (const hexKey of Object.keys(badges)) {
    if (!badges[hexKey]) continue;
    const pubkey = hexToBase58(hexKey);
    if (!pubkey) continue;
    const inserted = yield* World.resolve(insertBadge, { pubkey, block_height: blockHeight });
    // Backfill only when the badge is NEW. midnight-badges is a full-snapshot fold
    // every block, so an unconditional backfill would re-issue the accept-UPDATE
    // for every badge forever; RETURNING gives a row only on a real insert.
    if (inserted.length > 0) {
      // A post from this author that arrived before the badge synced was rejected
      // only for lack of a badge. Now that the badge is here, accept it — this
      // resolves the cross-chain ordering race.
      yield* World.resolve(acceptPostsForAuthor, { author: pubkey });
    }
  }
});

// Arbiter: a post is counted only if its signer holds a Midnight badge. The
// cross-chain link is a proof result, not a value the user handed to both sides.
stm.addStateTransition("solana-post", function* (data) {
  const { parsedInput, blockHeight } = data;
  const { slot, programId, logMessages } = parsedInput as any;

  if (programId !== POST_PROGRAM_ID) return;

  for (const raw of logMessages as string[]) {
    const parsed = parsePostLog(raw);
    if (!parsed) continue;

    const { author, body } = parsed;

    const badge = yield* World.resolve(getBadge, { pubkey: author });
    const accepted = badge.length > 0;

    yield* World.resolve(insertPost, {
      author,
      body,
      slot: String(slot),
      block_height: blockHeight,
      accepted,
      reason: accepted ? REASON_BADGE_VERIFIED : REASON_NO_BADGE,
    });
  }
});

export const gameStateTransitions: StartConfigGameStateTransitions =
  function* (
    _blockHeight: number,
    input: BaseStfInput,
  ): SyncStateUpdateStream<void> {
    yield* stm.processInput(input);
  };
