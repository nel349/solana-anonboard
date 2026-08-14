import { runPreparedQuery } from "@effectstream/db";
import {
  getAllBadges,
  getAllCounters,
  getAllPosts,
  getCounterByAuthority,
  getRecentEvents,
} from "@solana-starter/database";
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
  server.get<{ Params: { authority: string } }>(
    "/api/counter/:authority",
    async (request, reply) => {
      const result = await safeRead(
        () => runPreparedQuery(
          getCounterByAuthority.run({ authority: request.params.authority }, dbConn),
          "/api/counter/:authority",
        ),
        "/api/counter/:authority",
      );
      if (result.length === 0) {
        reply.code(404).send({ error: "counter not found", authority: request.params.authority });
        return;
      }
      reply.send({ counter: result[0] });
    },
  );

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

  server.get("/api/counters", async (_request, reply) => {
    const result = await safeRead(
      () => runPreparedQuery(getAllCounters.run(undefined, dbConn), "/api/counters"),
      "/api/counters",
    );
    reply.send({ counters: result });
  });

  server.get<{ Querystring: { limit?: string } }>(
    "/api/counter-events",
    async (request, reply) => {
      // `?limit=abc` -> NaN, which used to reach Postgres and 500. Fall back.
      const requested = Number(request.query.limit ?? "50");
      const limit = Number.isFinite(requested)
        ? Math.min(Math.max(Math.trunc(requested), 1), 500)
        : 50;
      const result = await safeRead(
        () => runPreparedQuery(getRecentEvents.run({ limit }, dbConn), "/api/counter-events"),
        "/api/counter-events",
      );
      reply.send({ events: result });
    },
  );
};
