import { serveClient } from "./static";
import { readConfig } from "./config";
import { createDatabase } from "./db";
import { createApplication } from "./app";
import { log } from "./log";
import { configureTelemetry, stopTelemetry } from "./telemetry";
const config = readConfig(process.env);
configureTelemetry(config.MOVIEFINDER_TELEMETRY_DIR);
const { db, pool } = createDatabase(config.DATABASE_URL),
  service = createApplication(db, config);
serveClient(service.app, service.auth);
const server = Bun.serve({
  hostname: "0.0.0.0",
  port: config.PORT,
  idleTimeout: 60,
  fetch: service.app.fetch,
});
service.sync.start();
const warm = setInterval(
  () => void service.sync.warm().catch(() => log("sync", "Cache warming deferred")),
  300000,
);
warm.unref();
log("boot", "MovieFinder listening", { port: config.PORT });
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(warm);
  service.stop();
  await server.stop();
  await pool.end();
  stopTelemetry();
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
