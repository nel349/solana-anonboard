import { runPreparedQuery } from "@effectstream/db";
import {
  getAllBadges,
  getAllPosts,
} from "@solana-anonboard/database";
import type { Pool } from "pg";
import type { StartConfigApiRouter } from "@effectstream/runtime";
import type { FastifyInstance } from "fastify";

// Reads during the startup window before migrations create tables throw 42P01;
// the frontend polls on a loop, so treat missing-relation/transient errors as
// "not ready" and return empty.
async function safeRead<T>(
  run: () => Promise<T[]>,
  label: string,
): Promise<T[]> {
  try {
    return await run();
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "42P01") return []; // table not created yet — normal at startup
    console.warn(`[api] ${label} read failed (${code ?? "unknown"}); returning empty`);
    return [];
  }
}

// DB is mutated only by the STM, never here — keeps replays deterministic.
export const apiRouter: StartConfigApiRouter = async function (
  server: FastifyInstance,
  dbConn: Pool,
): Promise<void> {
  // /api/badges: anon member badges mirrored from Midnight. /api/posts: Solana
  // posts tagged accepted by the arbiter — accepted:false rows prove the check runs.
  server.get("/api/badges", async (_request, reply) => {
    const result = await safeRead(
      () => runPreparedQuery(getAllBadges.run(undefined, dbConn), "/api/badges"),
      "/api/badges",
    );
    reply.send({ badges: result });
  });

  server.get("/api/posts", async (_request, reply) => {
    const result = await safeRead(
      () => runPreparedQuery(getAllPosts.run(undefined, dbConn), "/api/posts"),
      "/api/posts",
    );
    reply.send({
      posts: result,
      accepted: result.filter((p) => (p as { accepted: boolean }).accepted).length,
      rejected: result.filter((p) => !(p as { accepted: boolean }).accepted).length,
    });
  });
};
