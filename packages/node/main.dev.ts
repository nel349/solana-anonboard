import { init, start } from "@effectstream/runtime";
import { main, suspend, call } from "effection";
import {
  toSyncProtocolWithNetwork,
  withEffectstreamStaticConfig,
} from "@effectstream/config";
import { getConnection } from "@effectstream/db";
import { config } from "./config.dev.ts";
import { grammar } from "./grammar.ts";
import { gameStateTransitions } from "./state-machine.ts";
import { apiRouter } from "./api.ts";
import { migrationTable } from "@solana-starter/database";

// Create the app schema (posts/badges/counter_*) BEFORE block processing.
//
// The framework applies our `migrations` as USER migrations, which only run when
// the sync PROCESSES main block 1 (getMigrationsForBlockHeight defaults a
// missing blockHeight to 1). On boot the Solana leg first catches up a burst of
// slots before block 1 is assembled, and a query against posts/badges in that
// window rejects with 42P01 ("relation does not exist") and kills the critical
// sync process. Creating the schema up front (the SQL is idempotent —
// CREATE TABLE IF NOT EXISTS) closes that window: the tables exist before
// anything can read them, and the later block-1 user migration is a no-op.
// PGLite allows a single connection, so we release the pool before start().
async function ensureAppSchema(): Promise<void> {
  const pool = getConnection();
  try {
    for (const migration of migrationTable) {
      await pool.query(migration.sql);
    }
    console.log("[sync] app schema ensured (posts/badges) before block processing");
  } finally {
    await pool.end();
  }
}

// Surface otherwise-silent fatal errors. The runtime swallows unhandled
// rejections, so the sync process was exiting code 1 with no stack trace.
process.on("unhandledRejection", (e) => {
  console.error("[sync] UNHANDLED REJECTION:", e);
});
process.on("uncaughtException", (e) => {
  console.error("[sync] UNCAUGHT EXCEPTION:", e);
});

main(function* () {
  yield* init();
  yield* withEffectstreamStaticConfig(config, function* () {
    yield* call(() => ensureAppSchema());
    yield* start({
      appName: "solana-starter",
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
