import { init, start } from "@effectstream/runtime";
import { main, suspend, call } from "effection";
import {
  toSyncProtocolWithNetwork,
  withEffectstreamStaticConfig,
} from "@effectstream/config";
import { getConnection } from "@effectstream/db";
import { config, seededBadges } from "./config.dev.ts";
import { insertSeedBadges } from "./badge-seed.ts";
import { grammar } from "./grammar.ts";
import { gameStateTransitions } from "./state-machine.ts";
import { apiRouter } from "./api.ts";
import { migrationTable } from "@solana-anonboard/database";

// User migrations run only when main block 1 is processed, but the Solana leg
// catches up slots first — a query then hits 42P01 and kills the sync. Create the
// idempotent schema up front to close that window.
// PGLite allows a single connection, so we release the pool before start().
async function ensureAppSchema(): Promise<void> {
  const pool = getConnection();
  try {
    for (const migration of migrationTable) {
      await pool.query(migration.sql);
    }
    // Seed existing members from on-chain state so a near-head start still knows them.
    if (seededBadges) {
      await insertSeedBadges(pool, seededBadges);
      console.log(`[sync] seeded ${seededBadges.badges.length} on-chain badge(s)`);
    }
    console.log("[sync] app schema ensured (posts/badges) before block processing");
  } finally {
    await pool.end();
  }
}

// A dead sync coroutine must NOT become a silent zombie that keeps answering the
// API with stale data while no new posts/badges are folded. Log AND exit(1) so
// the orchestrator (or any supervisor) surfaces the failure and can restart — a
// log-only handler would suppress the runtime's own exit-on-unhandled-rejection.
process.on("unhandledRejection", (e) => {
  console.error("[sync] UNHANDLED REJECTION:", e);
  process.exit(1);
});
process.on("uncaughtException", (e) => {
  console.error("[sync] UNCAUGHT EXCEPTION:", e);
  process.exit(1);
});

main(function* () {
  yield* init();
  yield* withEffectstreamStaticConfig(config, function* () {
    yield* call(() => ensureAppSchema());
    yield* start({
      appName: "solana-anonboard",
      appVersion: "1.0.0",
      syncInfo: toSyncProtocolWithNetwork(config),
      gameStateTransitions,
      migrations: migrationTable,
      apiRouter,
      grammar,
    });
  });
  yield* suspend();
});
