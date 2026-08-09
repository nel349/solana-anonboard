import { init, start } from "@effectstream/runtime";
import { main, suspend } from "effection";
import {
  toSyncProtocolWithNetwork,
  withEffectstreamStaticConfig,
} from "@effectstream/config";
import { config } from "./config.dev.ts";
import { grammar } from "./grammar.ts";
import { gameStateTransitions } from "./state-machine.ts";
import { apiRouter } from "./api.ts";
import { migrationTable } from "@solana-starter/database";

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
