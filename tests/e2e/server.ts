import { configureTelemetry, stopTelemetry } from "../../src/server/telemetry";
import { createServer } from "vite-plus";
import { sql } from "drizzle-orm";
import { createDatabase } from "../../src/server/db";
import { createApplication } from "../../src/server/app";
import { readConfig } from "../../src/server/config";
import { createEntityStore } from "../../src/server/entity-store";
import { serveClient } from "../../src/server/static";
import { fixtureUpstream, movieDetail, television, fixtures } from "../fixtures/catalog";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Disposable test database required");
const observing = process.env.MOVIEFINDER_OBSERVABILITY_TEST === "1";
if (observing) configureTelemetry(process.env.MOVIEFINDER_TELEMETRY_DIR);
const { db, pool } = createDatabase(url);
await db.execute(
  sql`truncate moviefinder."user",moviefinder.source_entity,moviefinder.query_cache,moviefinder.sync_job,moviefinder.event cascade`,
);
const store = createEntityStore(db);
await db.transaction(async (tx) => {
  for (const m of [movieDetail, ...fixtures])
    await store.ingest(tx, `tmdb:movie:${m.id}`, m, "detail");
  await store.ingest(
    tx,
    "tmdb:tv:1399",
    { ...television, ...(await fixtureUpstream("tv/1399")) },
    "detail",
  );
});
const service = createApplication(
  db,
  readConfig({
    DATABASE_URL: url,
    BETTER_AUTH_SECRET: "browser-tests-only-long-isolated-secret-12345",
    MOVIEFINDER_ORIGIN: observing ? "http://127.0.0.1:5189" : "http://127.0.0.1:5188",
    PORT: "5188",
    NODE_ENV: "test",
  }),
  async (path, params) => {
    if (observing) await Bun.sleep(100);
    const result = await fixtureUpstream(path, params);
    return observing && path.startsWith("person/")
      ? { ...result, profile_path: "/observability-person.jpg" }
      : result;
  },
);
serveClient(service.app, service.auth);
service.sync.start();
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 5188,
  fetch: service.app.fetch,
  idleTimeout: 60,
});
const frontend = observing
  ? await createServer({
      server: {
        host: "127.0.0.1",
        port: 5189,
        strictPort: true,
        proxy: { "/api": "http://127.0.0.1:5188", "/health": "http://127.0.0.1:5188" },
      },
    })
  : undefined;
await frontend?.listen();
async function stop() {
  await frontend?.close();
  stopTelemetry();
  service.stop();
  await server.stop(true);
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
