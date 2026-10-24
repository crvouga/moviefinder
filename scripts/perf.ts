import { startGoogle, type GoogleTestProvider } from "../tests/fixtures/google";
import { completeGoogleSignIn, setTestUsername } from "../tests/fixtures/google-browser";
import { chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { openLocalDatabase, migrateLocalDatabase } from "./local-database";
import { createDatabase } from "../src/server/db";
import { createApplication } from "../src/server/app";
import { createEntityStore } from "../src/server/entity-store";
import { readConfig } from "../src/server/config";
import { configureTelemetry, stopTelemetry } from "../src/server/telemetry";
import { fixtureUpstream, movieDetail } from "../tests/fixtures/catalog";

// Reproducible performance run: isolated embedded PostgreSQL, a synthetic catalog, the real
// Vite dev client, and a scripted browser session. Prints the telemetry summary afterwards.
//   bun run perf [--titles 2000] [--seed 600] [--lists 12] [--throttle 4] [--headed] [--keep]
//   bun run perf --drawer [--profile]   # focused add-to-list open/close reproduction
const args = process.argv.slice(2);
const option = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
type CpuProfile = {
  nodes: {
    id: number;
    callFrame: { functionName: string; url: string; lineNumber: number };
  }[];
  samples: number[];
  timeDeltas: number[];
};
// Self time per function, so the cost is attributed to code rather than to a frame.
function printProfile(profile: CpuProfile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node.callFrame]));
  const self = new Map<string, number>();
  let total = 0;
  profile.samples.forEach((id, i) => {
    const frame = nodes.get(id)!;
    const delta = (profile.timeDeltas[i] ?? 0) / 1000;
    if (frame.functionName === "(idle)") return;
    total += delta;
    const name = `${frame.functionName || "(anonymous)"} ${frame.url.replace(/^.*\/(?=src\/|node_modules\/)/, "").replace(/\?.*$/, "")}:${frame.lineNumber + 1}`;
    self.set(name, (self.get(name) ?? 0) + delta);
  });
  console.log(`\n## cpuProfile (self time, ${Math.round(total)} ms busy; ${throttle}x throttle)`);
  for (const [name, ms] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25))
    console.log(`${String(Math.round(ms)).padStart(7)} ms  ${name}`);
}
const seeded = option("seed", 600),
  listCount = option("lists", 12);
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
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let activePage: Awaited<ReturnType<NonNullable<typeof browser>["newPage"]>> | undefined;
let closeApplication = async () => {};
let exitCode = 0;
let google: GoogleTestProvider | undefined;
try {
  database = await openLocalDatabase(directory);
  await migrateLocalDatabase(database.url);
  configureTelemetry(telemetry);
  const { db, pool } = createDatabase(database.url);
  closeApplication = () => pool.end();
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
  // A database that has been used for a while already holds many cached titles.
  const store = createEntityStore(db);
  await db.transaction(async (tx) => {
    for (let i = 1; i <= seeded; i++) {
      await store.ingest(tx, `tmdb:movie:${i}`, synthetic("movie", i));
      if (i % 4 === 0) await store.ingest(tx, `tmdb:tv:${i}`, synthetic("tv", i));
    }
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
    // Long-running series and prolific people are what make detail pages heavy.
    if (path.startsWith("tv/") && path.includes("/season/")) {
      const season = Number(path.split("/").at(-1));
      return {
        id: id * 100 + season,
        name: `Season ${season}`,
        season_number: season,
        episodes: Array.from({ length: 22 }, (_, n) => ({
          id: id * 10000 + season * 100 + n,
          name: `Episode ${n + 1}`,
          episode_number: n + 1,
          air_date: "2010-01-01",
          overview: "An episode used to measure interface performance.",
        })),
      };
    }
    if (path.startsWith("person/") && id)
      return {
        id,
        name: `Synthetic person ${id}`,
        biography: "A prolific performer. ".repeat(20),
        known_for_department: "Acting",
        combined_credits: {
          cast: Array.from({ length: 300 }, (_, n) => {
            const target = ((id * 7 + n) % titles) + 1;
            return {
              ...synthetic(n % 4 === 0 ? "tv" : "movie", target),
              media_type: n % 4 === 0 ? "tv" : "movie",
              credit_id: `credit-${id}-${n}`,
              character: `Role ${n}`,
            };
          }),
          crew: Array.from({ length: 40 }, (_, n) => ({
            ...synthetic("movie", ((id * 11 + n) % titles) + 1),
            media_type: "movie",
            credit_id: `crew-${id}-${n}`,
            job: n % 2 ? "Director" : "Writer",
            department: n % 2 ? "Directing" : "Writing",
          })),
        },
      };
    if ((path.startsWith("movie/") || path.startsWith("tv/")) && id) {
      const tv = path.startsWith("tv/");
      return {
        ...fixtureDetail(type),
        ...synthetic(tv ? "tv" : "movie", id),
        credits: {
          cast: Array.from({ length: 60 }, (_, n) => ({
            id: 1000 + ((id * 13 + n) % 400),
            name: `Synthetic person ${1000 + ((id * 13 + n) % 400)}`,
            character: `Role ${n}`,
            credit_id: `cast-${id}-${n}`,
            profile_path: `/synthetic-person-${n}.jpg`,
          })),
          crew: [],
        },
        recommendations: {
          results: Array.from({ length: 20 }, (_, n) => ({
            ...synthetic(tv ? "tv" : "movie", ((id + n * 37) % titles) + 1),
            media_type: tv ? "tv" : "movie",
          })),
        },
        ...(tv
          ? {
              number_of_seasons: 10,
              number_of_episodes: 220,
              seasons: Array.from({ length: 10 }, (_, n) => ({
                id: id * 100 + n + 1,
                name: `Season ${n + 1}`,
                season_number: n + 1,
              })),
            }
          : {}),
      };
    }
    return fixtureUpstream(path, params);
  };
  const fixtureDetail = (type: "movie" | "tv") =>
    type === "tv" ? { number_of_seasons: 1, seasons: [] } : movieDetail;
  const [apiPort, webPort] = [await freePort(), await freePort()];
  const origin = `http://localhost:${webPort}`;
  google = await startGoogle(origin);
  const service = createApplication(
    db,
    readConfig({
      ...google.config,
      DATABASE_URL: database.url,
      BETTER_AUTH_SECRET: "performance-runs-only-long-isolated-secret-12345",
      MOVIEFINDER_ORIGIN: origin,
      MOVIEFINDER_TELEMETRY_DIR: telemetry,
      PORT: String(apiPort),
      NODE_ENV: "test",
    }),
    upstream,
  );
  closeApplication = async () => {
    service.stop();
    await pool.end();
  };
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
  browser = await chromium.launch({ headless: !args.includes("--headed") });
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  ).newPage();
  activePage = page;
  page.on("crash", () => console.error("Performance browser renderer crashed"));
  page.on("pageerror", (error) => console.error(`Performance browser error: ${error.message}`));
  if (throttle > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  }
  // Remote artwork is irrelevant to this measurement and would only add network noise.
  await page.route(/image\.tmdb\.org/, (route) => route.fulfill({ status: 204 }));
  const profiler = args.includes("--profile")
    ? await page.context().newCDPSession(page)
    : undefined;
  await profiler?.send("Profiler.enable");
  await profiler?.send("Profiler.setSamplingInterval", { interval: 500 });
  await profiler?.send("Profiler.start");
  const mark = async (label: string, work: () => Promise<unknown>) => {
    const started = Date.now();
    await work();
    console.log(`${label}: ${Date.now() - started} ms`);
  };
  await mark("register and first discover render", async () => {
    await page.goto(`${origin}/`);
    const suffix = crypto.randomUUID().slice(0, 8);
    await completeGoogleSignIn(page, { name: "Perf Friend", email: `perf_${suffix}@example.test` });
    await setTestUsername(page, "Perf Friend", `perf_${suffix}`);
    await page.locator(".discovery-slide").first().waitFor({ timeout: 60000 });
  });
  await page.waitForTimeout(3000);
  const primaryNavigation = async () => {
    const times: string[] = [];
    for (const [label, path] of [
      ["Collections", "/lists"],
      ["Community", "/activity"],
      ["Your profile", "/profile"],
      ["Search", "/search"],
      ["Discover", "/"],
    ]) {
      await page.evaluate((path) => {
        const metrics = window as unknown as { __primaryNavigationMs?: number };
        delete metrics.__primaryNavigationMs;
        window.addEventListener(
          "pointerdown",
          (event) => {
            const started = event.timeStamp;
            const observer = new MutationObserver(() => {
              if (document.querySelector("#main-content")?.getAttribute("data-route") !== path)
                return;
              observer.disconnect();
              requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                  metrics.__primaryNavigationMs = performance.now() - started;
                }),
              );
            });
            observer.observe(document.body, { subtree: true, childList: true, attributes: true });
          },
          { capture: true, once: true },
        );
      }, path!);
      await page.getByRole("link", { name: label!, exact: true }).first().click();
      await page.waitForFunction(
        () =>
          typeof (window as unknown as { __primaryNavigationMs?: number }).__primaryNavigationMs ===
          "number",
      );
      const ms = await page.evaluate(
        () => (window as unknown as { __primaryNavigationMs: number }).__primaryNavigationMs,
      );
      times.push(`${path} ${Math.round(ms)} ms`);
      await page.waitForTimeout(300);
    }
    console.log(`  primary link press to destination paint opportunity: ${times.join(", ")}`);
  };
  await mark("primary navigation before browsing", primaryNavigation);
  if (args.includes("--drawer")) {
    page.on("dialog", async (dialog) => {
      console.error("Drawer opened a blocking native browser dialog");
      await dialog.dismiss();
      exitCode = 1;
    });
    for (const populated of [false, true]) {
      if (populated) {
        await page.evaluate(async (count) => {
          for (let n = 0; n < count; n++) {
            await fetch("/api/command", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                type: "list.create",
                operationId: crypto.randomUUID(),
                title: `Drawer list ${n}`,
                description: "",
              }),
            });
          }
        }, listCount);
        await page.reload();
        await page.locator(".swiper-slide-active").waitFor();
      }
      for (let n = 0; n < 3; n++) {
        await mark(`drawer ${populated ? "with lists" : "empty"} open/close ${n + 1}`, async () => {
          await page
            .locator(".swiper-slide-active")
            .getByRole("button", { name: "Add to list" })
            .click();
          const drawer = page.getByRole("dialog", { name: "Save for a good night" });
          await drawer.waitFor({ timeout: 5000 });
          await drawer.getByRole("button", { name: "Create a list" }).waitFor({ timeout: 5000 });
          await drawer.getByRole("button", { name: "Create a list", exact: true }).click();
          const input = drawer.getByRole("textbox", { name: "List name", exact: true });
          await input.pressSequentially("A responsive movie night", { delay: 20 });
          if ((await input.inputValue()) !== "A responsive movie night")
            throw new Error("Drawer input did not accept typing");
          const frameMs = await page.evaluate(
            () =>
              new Promise<number>((resolve) => {
                const started = performance.now();
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => resolve(performance.now() - started)),
                );
              }),
          );
          console.log(`  drawer form next paint opportunity: ${Math.round(frameMs)} ms`);
          await drawer.getByRole("button", { name: "Close", exact: true }).click({ timeout: 5000 });
          await drawer.waitFor({ state: "hidden", timeout: 5000 });
        });
      }
    }
  } else {
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
    // Measure the destination's next paint opportunity separately from background enrichment.
    const openPerson = async (n: number) => {
      const card = page.locator(".person-card").nth(n);
      const href = (await card.getAttribute("href"))!;
      const id = decodeURIComponent(href.split("/").at(-1)!);
      await page.evaluate((id) => {
        const metrics = window as unknown as {
          __navigationTiming?: { shell: number; data?: number; started: number };
        };
        delete metrics.__navigationTiming;
        window.addEventListener(
          "pointerdown",
          (event) => {
            const started = event.timeStamp;
            const observer = new MutationObserver(check);
            function check() {
              if (document.querySelector(".detail-page")?.getAttribute("data-title-id") !== id)
                return;
              observer.disconnect();
              requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                  metrics.__navigationTiming = { shell: performance.now() - started, started };
                }),
              );
            }
            observer.observe(document.body, { subtree: true, childList: true, attributes: true });
            check();
          },
          { capture: true, once: true },
        );
      }, id);
      // Preserve the chosen identity if live graph hydration inserts earlier cast cards.
      await page.locator(`.person-card[href="${href}"]`).first().click();
      await page.waitForFunction(() =>
        Boolean((window as unknown as { __navigationTiming?: unknown }).__navigationTiming),
      );
      await page.getByRole("heading", { name: "A career in stories." }).waitFor({ timeout: 30000 });
      return page.evaluate(() => {
        const value = (
          window as unknown as { __navigationTiming: { shell: number; started: number } }
        ).__navigationTiming;
        return {
          shell: Math.round(value.shell),
          data: Math.round(performance.now() - value.started),
        };
      });
    };
    await mark("cold navigation to five people", async () => {
      await page.goto(`${origin}/title/${encodeURIComponent("tmdb:tv:5")}`);
      await page.locator(".person-card").first().waitFor({ timeout: 60000 });
      const times: { shell: number; data: number }[] = [];
      let reads = 0;
      page.on("request", (r) => /\/api\/titles?[/?]/.test(r.url()) && reads++);
      for (const n of [20, 22, 24, 26, 28]) {
        await page.waitForTimeout(1500);
        times.push(await openPerson(n));
        await page.goBack();
        await page.locator(".person-card").first().waitFor({ timeout: 30000 });
      }
      console.log(
        `  press to destination paint opportunity (ms): ${times.map((t) => t.shell).join(", ")}`,
      );
      console.log(
        `  press to filmography (ms): ${times.map((t) => t.data).join(", ")}; title reads: ${reads}`,
      );
    });
    await mark("prepared navigation to five people", async () => {
      const times: { shell: number; data: number }[] = [];
      for (const n of [0, 1, 2, 3, 4]) {
        await page.locator(".person-card").nth(n).hover();
        await page.waitForTimeout(1800);
        times.push(await openPerson(n));
        await page.goBack();
        await page.locator(".person-card").first().waitFor();
      }
      console.log(
        `  prepared press to destination paint opportunity (ms): ${times.map((t) => t.shell).join(", ")}`,
      );
      console.log(`  prepared press to filmography (ms): ${times.map((t) => t.data).join(", ")}`);
    });
    await mark("cached neighbour graph with its direct API response blocked", async () => {
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const pattern = /\/api\/title\/.*person/i;
      await page.route(pattern, async (route) => {
        await blocked;
        await route.continue().catch(() => {});
      });
      try {
        // A fresh client receives the cached first-screen graph in its parent's response.
        await page.goto(`${origin}/title/${encodeURIComponent("tmdb:tv:5")}`);
        await page.locator(".person-card").first().waitFor({ timeout: 30000 });
        const timing = await openPerson(0);
        await page.locator('.detail-page[data-content-ready="true"]').waitFor();
        console.log(
          `  cached graph press to destination / filmography (ms): ${timing.shell} / ${timing.data}`,
        );
      } finally {
        release();
        await page.unroute(pattern);
      }
    });
    await mark("browse people and series without reloading", async () => {
      await page.goto(`${origin}/title/${encodeURIComponent("tmdb:tv:5")}`);
      await page.locator(".detail-intro h1").waitFor({ timeout: 60000 });
      // Skimming across the cast the way a pointer does, twice: the second pass should be free.
      for (let pass = 0; pass < 2; pass++)
        for (const card of await page.locator(".person-card").all()) {
          await card.hover();
          await page.waitForTimeout(160);
        }
      // Client-side navigation only, so the collections keep growing like a long real session.
      for (let step = 0; step < 24; step++) {
        await page.waitForTimeout(1200);
        const cards = page.locator(".person-card, .title-card");
        const count = await cards.count();
        if (!count) break;
        const before = await page.locator(".detail-intro h1").textContent();
        await cards.nth((step * 7) % Math.min(count, 18)).click();
        await page
          .waitForFunction(
            (title) => document.querySelector(".detail-intro h1")?.textContent !== title,
            before,
            { timeout: 30000 },
          )
          .catch(() => {});
      }
      const tab = page.getByRole("button", { name: "Acting", exact: true });
      if (await tab.count()) {
        await tab.click();
        await page.waitForTimeout(1500);
      }
    });
    await mark("lists, tags, activity and profile", async () => {
      // Fill the account the way weeks of use would: tags, lists with many items, activity.
      const listIds = await page.evaluate(
        async ({ lists, perList, tags }) => {
          const post = (json: unknown) =>
            fetch("/api/command", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(json),
            }).then((r) => r.json());
          const batches = async (count: number, work: (n: number) => Promise<unknown>) => {
            for (let n = 1; n <= count; n += 8)
              await Promise.all(
                Array.from({ length: Math.min(8, count - n + 1) }, (_, k) => work(n + k)),
              );
          };
          const ids: string[] = [];
          for (let l = 0; l < lists; l++) {
            const made = await post({
              type: "list.create",
              operationId: crypto.randomUUID(),
              title: `Perf list ${l}`,
              description: "A list used to measure interface performance.",
            });
            const listId = made.entities.find((e: { kind: string }) => e.kind === "list").id;
            ids.push(listId);
            await batches(perList, (n) =>
              post({
                type: "list.add",
                operationId: crypto.randomUUID(),
                listId,
                titleId: `tmdb:movie:${n + l * 3}`,
              }),
            );
          }
          await batches(tags, (n) =>
            post({
              type: "status",
              operationId: crypto.randomUUID(),
              titleId: `tmdb:movie:${n}`,
              sentiment: n % 3 ? "liked" : "meh",
              seen: n % 2 === 0,
            }),
          );
          return ids;
        },
        { lists: listCount, perList: 40, tags: 200 },
      );
      // Keep the accumulated client DB: reloads hid the cost of navigating a long session.
      await primaryNavigation();
      await page.getByRole("link", { name: "Collections", exact: true }).first().click();
      await page.locator(`a.list-card[href="/lists/${listIds[0]}"]`).click();
      await page.locator(".list-entry").first().waitFor();
    });
    await mark("lists and search", async () => {
      await page.goto(`${origin}/lists`);
      await page.waitForTimeout(2000);
      await page.goto(`${origin}/search?q=Synthetic`);
      await page.waitForTimeout(3000);
    });
  }
  await page.waitForTimeout(6000);
  await page.evaluate(() =>
    (
      window as unknown as { __moviefinderTelemetry?: { flush(): void } }
    ).__moviefinderTelemetry?.flush(),
  );
  await page.waitForTimeout(1000);
  if (profiler) {
    const { profile } = (await profiler.send("Profiler.stop")) as { profile: CpuProfile };
    printProfile(profile);
  }
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  if (activePage && !activePage.isClosed()) {
    const screenshot = resolve(".local/perf-failure.png");
    await activePage.screenshot({ path: screenshot, timeout: 2000 }).then(
      () => console.error(`Performance failure screenshot: ${screenshot}`),
      () => console.error("Performance browser did not respond to a failure screenshot"),
    );
  }
  exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await google?.close();
  await closeApplication();
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
