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
    console.log("[sync] app schema ensured (posts/badges) before block processing");
  } finally {
    await pool.end();
  }
}

// Runtime swallows unhandled rejections (silent exit 1) — surface them.
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
