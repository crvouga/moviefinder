import { chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { openLocalDatabase, migrateLocalDatabase } from "./local-database";
import { createDatabase } from "../src/server/db";
import { createApplication } from "../src/server/app";
import { readConfig } from "../src/server/config";
import { configureTelemetry, stopTelemetry } from "../src/server/telemetry";
import { fixtureUpstream, movieDetail } from "../tests/fixtures/catalog";

// Reproducible performance run: isolated embedded PostgreSQL, a synthetic catalog, the real
// Vite dev client, and a scripted browser session. Prints the telemetry summary afterwards.
//   bun run perf [--titles 2000] [--throttle 4] [--headed] [--keep]
const args = process.argv.slice(2);
const option = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const titles = option("titles", 2000),
  throttle = option("throttle", 4);
const directory = await mkdtemp(join(tmpdir(), "moviefinder-perf-"));
const telemetry = resolve(
  args.includes("--keep") ? ".local/perf-telemetry" : join(directory, "telemetry"),
);
async function freePort() {
  const probe = createServer();
  await new Promise<void>((accept) => probe.listen(0, "127.0.0.1", accept));
  const port = (probe.address() as { port: number }).port;
  await new Promise((accept) => probe.close(accept));
  return port;
}
const children: ChildProcess[] = [];
let database: Awaited<ReturnType<typeof openLocalDatabase>> | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let exitCode = 0;
try {
  database = await openLocalDatabase(directory);
  await migrateLocalDatabase(database.url);
  configureTelemetry(telemetry);
  const { db, pool } = createDatabase(database.url);
  const log = console.log;
  console.log = (...values: unknown[]) =>
    typeof values[0] === "string" && values[0].startsWith('{"timestamp"')
      ? undefined
      : log(...values);
  const genreIds = [28, 12, 16, 35, 80, 18, 14, 27, 878, 53];
  const synthetic = (type: "movie" | "tv", i: number) => ({
    id: i,
    ...(type === "tv"
      ? { name: `Synthetic series ${i}`, first_air_date: `${1990 + (i % 35)}-05-01` }
      : { title: `Synthetic story ${i}`, release_date: `${1980 + (i % 45)}-03-01` }),
    overview: "A film used to measure interface performance. ".repeat(4),
    poster_path: `/synthetic-${i}.jpg`,
    backdrop_path: `/synthetic-backdrop-${i}.jpg`,
    genre_ids: [genreIds[i % 10], genreIds[(i + 3) % 10]],
    popularity: 1000 - i / 4,
    vote_average: 5 + (i % 40) / 10,
    vote_count: 1000,
    original_language: "en",
  });
  // A catalog of `titles` entries served 20 per page with realistic provider latency.
  const upstream = async (path: string, params: Record<string, string> = {}) => {
    await Bun.sleep(60);
    const type = path.includes("/tv") ? "tv" : "movie";
    if (path.startsWith("discover/") || path.startsWith("trending/")) {
      const page = Number(params.page ?? 1);
      return {
        page,
        total_pages: Math.ceil(titles / 20),
        results: Array.from({ length: 20 }, (_, n) => synthetic(type, (page - 1) * 20 + n + 1)),
      };
    }
    const id = Number(path.split("/")[1]);
    if ((path.startsWith("movie/") || path.startsWith("tv/")) && id)
      return { ...fixtureDetail(type), ...synthetic(path.startsWith("tv/") ? "tv" : "movie", id) };
    return fixtureUpstream(path, params);
  };
  const fixtureDetail = (type: "movie" | "tv") =>
    type === "tv" ? { number_of_seasons: 1, seasons: [] } : movieDetail;
  const [apiPort, webPort] = [await freePort(), await freePort()];
  const origin = `http://localhost:${webPort}`;
  const service = createApplication(
    db,
    readConfig({
      DATABASE_URL: database.url,
      BETTER_AUTH_SECRET: "performance-runs-only-long-isolated-secret-12345",
      MOVIEFINDER_ORIGIN: origin,
      MOVIEFINDER_TELEMETRY_DIR: telemetry,
      PORT: String(apiPort),
      NODE_ENV: "development",
    }),
    upstream,
  );
  service.sync.start();
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: apiPort,
    fetch: service.app.fetch,
    idleTimeout: 60,
  });
  const vite = spawn("bun", ["x", "--no-install", "vp", "dev"], {
    stdio: "ignore",
    env: { ...process.env, PORT: String(apiPort), MOVIEFINDER_WEB_PORT: String(webPort) },
  });
  children.push(vite);
  for (let attempt = 0; attempt < 60; attempt++) {
    if ((await fetch(`${origin}/health`).catch(() => undefined))?.ok) break;
    await Bun.sleep(500);
  }
  const browser = await chromium.launch({ headless: !args.includes("--headed") });
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  ).newPage();
  if (throttle > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  }
  // Remote artwork is irrelevant to this measurement and would only add network noise.
  await page.route(/image\.tmdb\.org/, (route) => route.fulfill({ status: 204 }));
  const mark = async (label: string, work: () => Promise<unknown>) => {
    const started = Date.now();
    await work();
    console.log(`${label}: ${Date.now() - started} ms`);
  };
  await mark("register and first discover render", async () => {
    await page.goto(`${origin}/`);
    await page.getByRole("button", { name: /Make yourself at home/ }).click();
    const suffix = crypto.randomUUID().slice(0, 8);
    await page.getByLabel("Display name", { exact: true }).fill("Perf Friend");
    await page.getByLabel("Username", { exact: true }).fill(`perf_${suffix}`);
    await page.getByLabel("Email address").fill(`perf_${suffix}@example.test`);
    await page.getByLabel("Password", { exact: true }).fill("a-strong-performance-password");
    await page.getByRole("button", { name: "Create your account" }).click();
    await page.locator(".discovery-slide").first().waitFor({ timeout: 60000 });
  });
  await page.waitForTimeout(3000);
  await mark("scroll 30 slides", async () => {
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(350);
    }
  });
  await mark("tag, open a title, go back", async () => {
    const slide = page.locator(".swiper-slide-active");
    await slide.getByRole("button", { name: "Like", exact: true }).click();
    await slide.locator(".slide-title").click();
    await page.locator(".detail-intro h1").waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.goBack();
    await page.locator(".discovery-slide").first().waitFor();
  });
  await mark("lists and search", async () => {
    await page.goto(`${origin}/lists`);
    await page.waitForTimeout(2000);
    await page.goto(`${origin}/search?q=Synthetic`);
    await page.waitForTimeout(3000);
  });
  await page.waitForTimeout(6000);
  await page.evaluate(() =>
    (
      window as unknown as { __moviefinderTelemetry?: { flush(): void } }
    ).__moviefinderTelemetry?.flush(),
  );
  await page.waitForTimeout(1000);
  await browser.close();
  service.stop();
  await pool.end();
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  exitCode = 1;
} finally {
  for (const child of children) child.kill("SIGTERM");
  await server?.stop(true);
  stopTelemetry();
  await database?.stop();
}
if (exitCode === 0) {
  const report = Bun.spawn(
    ["bun", "scripts/telemetry.ts", ...(args.includes("--json") ? ["--json"] : [])],
    {
      stdout: "inherit",
      stderr: "inherit",
      env: { ...process.env, MOVIEFINDER_TELEMETRY_DIR: telemetry },
    },
  );
  await report.exited;
}
if (!args.includes("--keep")) await rm(directory, { recursive: true, force: true });
process.exit(exitCode);
