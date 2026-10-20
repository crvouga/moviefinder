import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { socialQueries } from "./social";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { streamSSE } from "hono/streaming";
import { eq, sql, min } from "drizzle-orm";
import { commandSchema, feedParams, sourceId, type EventEnvelope } from "../shared/contracts";
import type { Config } from "./config";
import type { Database } from "./db";
import { createAuth } from "./auth";
import { createQueries } from "./queries";
import { createSync } from "./entity-store-sync";
import { createTmdb, type Tmdb } from "./entity-store-sync/tmdb";
import { AppError, metrics, log } from "./log";
import { record, telemetryEnabled, timed } from "./telemetry";
import { executeCommand } from "./commands";
import { snapshot } from "./state";
import { replay } from "./events";
import { events, jobs } from "./db/schema";
import { assertDatabaseReady, databaseFailure } from "./db/readiness";
const telemetryBatch = z.object({
  events: z
    .array(
      z
        .object({ t: z.string().max(40), kind: z.string().max(40), name: z.string().max(200) })
        .catchall(z.union([z.string().max(500), z.number(), z.boolean(), z.null()])),
    )
    .max(500),
});
export function createApplication(db: Database, config: Config, upstream?: Tmdb) {
  const auth = createAuth(db, config),
    sync = createSync(db, upstream ?? createTmdb(config.TMDB_API_READ_ACCESS_TOKEN ?? "")),
    queries = createQueries(db, sync),
    social = socialQueries(db),
    shutdown = new AbortController();
  const root = new Hono<{ Variables: { userId: string; requestId: string } }>();
  root.use("*", async (c, next) => {
    const requestId = crypto.randomUUID(),
      start = performance.now();
    c.set("requestId", requestId);
    c.header("X-Request-Id", requestId);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header("X-Frame-Options", "DENY");
    await next();
    if (c.req.path !== "/api/events") {
      const milliseconds = Math.round(performance.now() - start);
      log("http", "Request completed", {
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        milliseconds,
      });
      if (telemetryEnabled() && c.req.path !== "/api/telemetry" && c.req.path.startsWith("/api/"))
        record("http", `${c.req.method} ${c.req.path}`, {
          requestId,
          status: c.res.status,
          ms: Math.round((performance.now() - start) * 10) / 10,
          bytes: (await c.res.clone().arrayBuffer()).byteLength,
          query: [...new URL(c.req.url).searchParams.keys()].join(",") || undefined,
        });
    }
  });
  root.onError((error, c) => {
    if (error instanceof AppError)
      return c.json({ error: error.message, requestId: c.get("requestId") }, error.status);
    const databaseCode =
      "code" in error
        ? error.code
        : error.cause && typeof error.cause === "object" && "code" in error.cause
          ? error.cause.code
          : undefined;
    if (databaseCode === "23505")
      return c.json({ error: "This value is already in use", requestId: c.get("requestId") }, 409);
    const failure = databaseFailure(error);
    if (failure) {
      const message =
        failure === "schema"
          ? "The MovieFinder database has not been initialized. Contact the service operator."
          : "The MovieFinder database is unavailable. Please try again later.";
      log("database", "Request could not access the application database", {
        requestId: c.get("requestId"),
        reason: failure,
      });
      return c.json(
        { error: message, message, code: "DATABASE_NOT_READY", requestId: c.get("requestId") },
        503,
      );
    }
    log("error", "Request failed", { requestId: c.get("requestId"), category: error.name });
    return c.json(
      { error: "The service could not complete this request", requestId: c.get("requestId") },
      503,
    );
  });
  root.use(
    "/api/*",
    bodyLimit({
      maxSize: 65536,
      onError: (c) => c.json({ error: "This request is too large" }, 413),
    }),
  );
  root.get("/health", (c) => c.json({ status: "ok", service: "moviefinder" }));
  root.get("/api/health", (c) => c.json({ status: "ok", service: "moviefinder" }));
  root.get("/api/auth-options", (c) =>
    c.json({
      recovery: !!config.RESEND_API_KEY && !!config.EMAIL_FROM,
      google: !!config.MOVIEFINDER_GOOGLE_CLIENT_ID && !!config.MOVIEFINDER_GOOGLE_CLIENT_SECRET,
    }),
  );
  root.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  root.use("/api/*", async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "Sign in to continue" }, 401);
    c.set("userId", session.user.id);
    if (
      !["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
      c.req.header("Origin") !== config.MOVIEFINDER_ORIGIN
    )
      return c.json({ error: "Untrusted request origin" }, 403);
    c.header("Cache-Control", "private, no-store");
    await next();
  });
  if (telemetryEnabled())
    root.post("/api/telemetry", zValidator("json", telemetryBatch), (c) => {
      for (const { t, kind, name, ...fields } of c.req.valid("json").events)
        record(kind, name, fields, "client", t);
      return c.body(null, 204);
    });
  const api = root
    .get("/api/ready", async (c) => {
      try {
        await assertDatabaseReady(db);
        return c.json({ status: "ready" });
      } catch {
        return c.json({ status: "unavailable" }, 503);
      }
    })
    .get("/api/metrics", async (c) => {
      const failed = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(jobs)
        .where(eq(jobs.state, "failed"));
      return c.json({ ...metrics, failedJobs: failed[0]?.count ?? 0 });
    })
    .get("/api/state", async (c) => {
      const state = await timed("snapshot", "state", () => snapshot(db, c.get("userId")));
      record("snapshot", "size", { entities: state.entities.length });
      return c.json(state);
    })
    .get("/api/discover", zValidator("query", feedParams), async (c) => {
      try {
        return c.json(
          await queries.discover(c.req.valid("query"), c.get("userId"), c.req.raw.signal),
        );
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes("cursor") || error.message.includes("Cursor"))
        )
          throw new AppError(400, "Invalid feed cursor");
        throw error;
      }
    })
    .get("/api/title/:id", async (c) => {
      const parsed = sourceId.safeParse(c.req.param("id"));
      if (!parsed.success) throw new AppError(400, "Invalid canonical title identity");
      return c.json(await queries.entity(parsed.data, c.get("userId"), c.req.raw.signal));
    })
    .get(
      "/api/social-search",
      zValidator(
        "query",
        z.object({
          q: z.string().trim().min(1).max(200),
          cursor: z.coerce.number().int().min(0).max(100000).default(0),
        }),
      ),
      async (c) => {
        const p = c.req.valid("query");
        return c.json(await social.search(p.q, p.cursor));
      },
    )
    .get(
      "/api/lists",
      zValidator(
        "query",
        z.object({
          cursor: z.uuid().optional(),
          scope: z.enum(["all", "mine", "saved"]).default("all"),
        }),
      ),
      async (c) =>
        c.json(
          await social.lists(
            c.get("userId"),
            c.req.valid("query").scope,
            c.req.valid("query").cursor,
          ),
        ),
    )
    .get(
      "/api/lists/:id",
      zValidator("query", z.object({ cursor: z.string().max(600).optional() })),
      async (c) =>
        c.json(await social.list(z.uuid().parse(c.req.param("id")), c.req.valid("query").cursor)),
    )
    .get(
      "/api/profiles/:id",
      zValidator("query", z.object({ cursor: z.string().max(200).optional() })),
      async (c) => c.json(await social.profile(c.req.param("id"), c.req.valid("query").cursor)),
    )
    .post("/api/command", zValidator("json", commandSchema), async (c) =>
      c.json(await executeCommand(db, c.get("userId"), c.req.valid("json"))),
    );
  root.get("/api/events", async (c) => {
    if (metrics.sseConnections >= 500)
      throw new AppError(503, "Live updates are at capacity. Reconnect shortly.");
    const raw = c.req.header("Last-Event-ID") ?? c.req.query("cursor") ?? "0";
    if (!/^\d{1,15}$/.test(raw)) throw new AppError(400, "Invalid event cursor");
    let cursor = Number(raw);
    const userId = c.get("userId");
    c.header("Cache-Control", "no-cache, no-transform");
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      metrics.sseConnections++;
      record("sse", "open", { cursor, connections: metrics.sseConnections });
      let closed = false;
      const onClose = () => {
        closed = true;
      };
      shutdown.signal.addEventListener("abort", onClose, { once: true });
      stream.onAbort(onClose);
      try {
        const [oldest] = await db.select({ id: min(events.id) }).from(events);
        if (cursor > 0 && oldest?.id && cursor < Number(oldest.id) - 1) {
          const state = await snapshot(db, userId);
          record("sse", "reset", { entities: state.entities.length });
          cursor = Number(state.cursor);
          const reset: EventEnvelope = {
            protocol: 1,
            id: state.cursor,
            type: "reset",
            subscription: "snapshot",
            entities: state.entities,
            removed: [],
            timestamp: new Date().toISOString(),
          };
          await stream.writeSSE({ event: "change", id: state.cursor, data: JSON.stringify(reset) });
        }
        let heartbeat = 0,
          lastAuth = Date.now();
        while (!closed) {
          if (Date.now() - lastAuth > 30000) {
            const active = await auth.api.getSession({ headers: c.req.raw.headers });
            if (!active) break;
            lastAuth = Date.now();
          }
          const rows = await replay(db, userId, cursor);
          if (rows.length) record("sse", "replay", { events: rows.length, cursor });
          for (const row of rows) {
            if (closed) break;
            cursor = row.id;
            metrics.replayedEvents++;
            await stream.writeSSE({
              event: "change",
              id: String(row.id),
              data: JSON.stringify({ ...row.payload, id: String(row.id) }),
            });
          }
          if (Date.now() - heartbeat > 15000) {
            await stream.writeSSE({ event: "heartbeat", data: "{}" });
            heartbeat = Date.now();
          }
          if (rows.length < 100) await stream.sleep(700);
        }
      } finally {
        metrics.sseConnections--;
        record("sse", "close", { connections: metrics.sseConnections });
        shutdown.signal.removeEventListener("abort", onClose);
      }
    });
  });
  return {
    app: root,
    api,
    auth,
    sync,
    stop() {
      shutdown.abort();
      sync.stop();
    },
  };
}
export type AppType = ReturnType<typeof createApplication>["api"];
