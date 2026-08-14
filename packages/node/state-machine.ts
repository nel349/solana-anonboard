import { Stm } from "@effectstream/sm";
import type { BaseStfInput } from "@effectstream/sm";
import type { StartConfigGameStateTransitions } from "@effectstream/runtime";
import { type SyncStateUpdateStream, World } from "@effectstream/coroutine";
import bs58 from "bs58";
import {
  acceptPostsForAuthor,
  getBadge,
  insertBadge,
  insertPost,
} from "@solana-anonboard/database";
import { grammar } from "./grammar.ts";
import { COUNTER_PROGRAM_ID } from "@solana-anonboard/contracts-solana/program-id";

const POST_LOG_PREFIX = "ANONBOARD_POST";

const stm = new Stm<typeof grammar, {}>(grammar);

// Midnight stores a badge as Bytes<32> and the map parser hands it back as
// hex. Solana logs the signer as base58. Normalise to base58 so the arbiter
// compares like with like. Getting this wrong looks identical to "nobody has
// a badge", which is a very quiet way to fail.
function hexToBase58(hex: string): string | null {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length !== 64 || !/^[0-9a-fA-F]+$/.test(clean)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bs58.encode(bytes);
}

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
    yield* World.resolve(insertBadge, { pubkey, block_height: blockHeight });
    // Backfill: a post from this author that arrived before the badge synced
    // was rejected only for lack of a badge. Now that the badge is here, accept
    // it. This resolves the cross-chain ordering race.
    yield* World.resolve(acceptPostsForAuthor, { author: pubkey });
  }
});

// Arbiter: a post is counted only if its signer holds a Midnight badge. The
// cross-chain link is a proof result, not a value the user handed to both sides.
stm.addStateTransition("solana-post", function* (data) {
  const { parsedInput, blockHeight } = data;
  const { slot, programId, logMessages } = parsedInput as any;

  if (programId !== COUNTER_PROGRAM_ID) return;

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
      reason: accepted ? "badge verified on midnight" : "no midnight badge",
    });
  }
});

// PREFIX|<author>|<slot>|<body> — reuses the counter program's log format;
// body stands in for post content in this PoC.
function parsePostLog(raw: string): { author: string; body: string } | null {
  const line = raw.startsWith("Program log: ")
    ? raw.slice("Program log: ".length)
    : raw;
  if (!line.startsWith(POST_LOG_PREFIX + "|")) return null;
  // ANONBOARD_POST|<author>|<slot>|<body>. Body is last and may contain '|',
  // so split only the first three fields and keep the remainder as the body.
  const parts = line.split("|");
  if (parts.length < 4) return null;
  const author = parts[1];
  const body = parts.slice(3).join("|");
  return { author, body };
}

export const gameStateTransitions: StartConfigGameStateTransitions =
  function* (
    _blockHeight: number,
    input: BaseStfInput,
  ): SyncStateUpdateStream<void> {
    yield* stm.processInput(input);
  };
