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

// Read-only HTTP routes (see README "API"). The DB is mutated only by the
// STM, never here, which keeps replays deterministic.
export const apiRouter: StartConfigApiRouter = async function (
  server: FastifyInstance,
  dbConn: Pool,
): Promise<void> {
  server.get<{ Params: { authority: string } }>(
    "/api/counter/:authority",
    async (request, reply) => {
      const result = await runPreparedQuery(
        getCounterByAuthority.run({ authority: request.params.authority }, dbConn),
        "/api/counter/:authority",
      );
      if (result.length === 0) {
        reply.code(404).send({ error: "counter not found", authority: request.params.authority });
        return;
      }
      reply.send({ counter: result[0] });
    },
  );

  // The two routes this project exists for.
  //
  // /api/badges — anonymous member badges mirrored from Midnight's ledger.
  // /api/posts  — Solana posts, each tagged with whether the arbiter accepted
  //               it. `accepted:false` rows are the proof the check is real.
  server.get("/api/badges", async (_request, reply) => {
    const result = await runPreparedQuery(
      getAllBadges.run(undefined, dbConn),
      "/api/badges",
    );
    reply.send({ badges: result });
  });

  server.get("/api/posts", async (_request, reply) => {
    const result = await runPreparedQuery(
      getAllPosts.run(undefined, dbConn),
      "/api/posts",
    );
    reply.send({
      posts: result,
      accepted: result.filter((p) => p.accepted).length,
      rejected: result.filter((p) => !p.accepted).length,
    });
  });

  server.get("/api/counters", async (_request, reply) => {
    const result = await runPreparedQuery(
      getAllCounters.run(undefined, dbConn),
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
      const result = await runPreparedQuery(
        getRecentEvents.run({ limit }, dbConn),
        "/api/counter-events",
      );
      reply.send({ events: result });
    },
  );
};
