import { readRows, bottlenecks, traces, formatTraces, formatBottlenecks } from "./telemetry-report";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

// Reads the local development telemetry written by the dev server and the browser.
//   bun run telemetry [summary] [--since 5m] [--json]
//   bun run telemetry tail [--kind http] [--name discover] [-n 40]
//   bun run telemetry slow [--min 50] [-n 30]
//   bun run telemetry clear
type Row = Record<string, string | number | boolean | null | undefined> & {
  t: string;
  source: string;
  kind: string;
  name: string;
};
const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith("-") ? args[0] : "summary";
const flag = (name: string) => {
  const i = args.findIndex((arg) => arg === `--${name}` || (name === "n" && arg === "-n"));
  return i >= 0 ? args[i + 1] : undefined;
};
const directory = process.env.MOVIEFINDER_TELEMETRY_DIR ?? ".local/telemetry";
const file = join(directory, "events.ndjson");
if (command === "clear") {
  await rm(file, { force: true });
  console.log("Telemetry cleared.");
  process.exit(0);
}
const unit = { s: 1000, m: 60_000, h: 3_600_000 } as const;
const since = flag("since")?.match(/^(\d+)([smh])$/);
const cutoff = since
  ? Date.now() - Number(since[1]) * unit[since[2] as keyof typeof unit]
  : command === "watch"
    ? Date.now() - 300_000
    : 0;
const text = await readFile(file, "utf8").catch(() => "");
if (!text && command !== "watch") {
  console.error(`No telemetry at ${file}. Start the app with bun run dev and use it first.`);
  process.exit(1);
}
const rows = readRows(text, cutoff);
if (["bottlenecks", "traces", "watch"].includes(command)) {
  const show = (items: Row[]) => {
    const report = command === "traces" ? traces(items, flag("trace")) : bottlenecks(items);
    console.log(
      args.includes("--json")
        ? JSON.stringify(report, null, 2)
        : command === "traces"
          ? formatTraces(report as ReturnType<typeof traces>, !!flag("trace"))
          : formatBottlenecks(report as ReturnType<typeof bottlenecks>),
    );
  };
  show(rows);
  if (command === "watch") {
    setInterval(async () => {
      const recent = readRows(
        await readFile(file, "utf8").catch(() => ""),
        Date.now() - (since ? Number(since[1]) * unit[since[2] as keyof typeof unit] : 300_000),
      );
      if (process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[H");
      show(recent);
    }, 2000);
    await new Promise(() => {});
  }
  process.exit(0);
}

const num = (value: unknown) => (typeof value === "number" ? value : 0);
const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))] ?? 0;
};
const r1 = (n: number) => Math.round(n * 10) / 10;
function group<T>(items: T[], key: (item: T) => string) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const id = key(item),
      held = map.get(id) ?? [];
    held.push(item);
    map.set(id, held);
  }
  return map;
}
const stats = (items: Row[]) => {
  const ms = items.map((r) => num(r.ms));
  return {
    n: items.length,
    totalMs: r1(ms.reduce((a, b) => a + b, 0)),
    p50: r1(percentile(ms, 50)),
    p95: r1(percentile(ms, 95)),
    max: r1(ms.reduce((max, ms) => Math.max(max, ms), 0)),
  };
};
const table = (items: Row[], key: (r: Row) => string, top = 10) =>
  [...group(items, key)]
    .map(([name, list]) => ({
      name,
      ...stats(list),
      ...(list.some((r) => r.bytes != null)
        ? { maxKB: Math.round(list.reduce((max, r) => Math.max(max, num(r.bytes)), 0) / 1024) }
        : {}),
    }))
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, top);
const only = (kind: string, source?: string) =>
  rows.filter((r) => r.kind === kind && (!source || r.source === source));

if (command === "tail") {
  const kind = flag("kind"),
    name = flag("name"),
    limit = Number(flag("n") ?? 40);
  const picked = rows.filter((r) => (!kind || r.kind === kind) && (!name || r.name.includes(name)));
  for (const row of picked.slice(-limit)) console.log(JSON.stringify(row));
  process.exit(0);
}
if (command === "slow") {
  const min = Number(flag("min") ?? 50),
    limit = Number(flag("n") ?? 30);
  const picked = rows
    .filter((r) => num(r.ms) >= min)
    .sort((a, b) => num(b.ms) - num(a.ms))
    .slice(0, limit);
  for (const row of picked) console.log(JSON.stringify(row));
  process.exit(0);
}
// Requests the browser repeated: same route and parameters again after it already had an answer.
// Repeated reads can be intentional refreshes; equality alone does not prove wasted work.
function redundancy() {
  const fetches = only("fetch", "client").filter(
    (r) => !r.failed && r.status === 200 && r.name.startsWith("GET "),
  );
  const seen = new Map<string, number>();
  const repeats = new Map<string, { n: number; kb: number }>();
  for (const r of fetches) {
    if (!r.key) continue; // Old recordings cannot establish identical requests safely.
    const key = `${r.page}:${r.key}`;
    if (seen.has(key)) {
      const entry = repeats.get(key) ?? { n: 0, kb: 0 };
      entry.n++;
      entry.kb += num(r.bytes) / 1024;
      repeats.set(key, entry);
    }
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const pool = only("pool", "client");
  const reads = pool.filter((r) => r.name === "request" || r.name === "join");
  return {
    fetches: fetches.length,
    repeatedFetches: [...repeats.values()].reduce((n, e) => n + e.n, 0),
    repeatedKB: Math.round([...repeats.values()].reduce((n, e) => n + e.kb, 0)),
    sessionChecks: only("http", "server").filter((r) => r.name === "GET /api/auth/get-session")
      .length,
    poolHitRate: reads.length
      ? Math.round((100 * reads.filter((r) => r.settled === true).length) / reads.length)
      : null,
    cancelledStarted: pool.filter((r) => r.name === "cancel" && r.started === true).length,
    worst: [...repeats]
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, 5)
      .map(([key, e]) => ({ key, extra: e.n })),
  };
}
const speculative = (r: Row) => r.speculative === true;
const loads = only("load", "client");
const pool = only("pool", "client");
const longTasks = only("longtask");
const runtime = (source: string) => rows.filter((r) => r.kind === "runtime" && r.source === source);
const lastOf = (list: Row[], key: string) => [...list].reverse().find((r) => r[key] != null)?.[key];
const summary = {
  window: { events: rows.length, from: rows[0]?.t, to: rows.at(-1)?.t },
  serverHttp: table(only("http"), (r) => r.name),
  serverDb: {
    ...stats(only("db")),
    slowest: only("db")
      .sort((a, b) => num(b.ms) - num(a.ms))
      .slice(0, 5)
      .map((r) => ({ ms: r.ms, rows: r.rows, sql: r.sql })),
    repeated: table(only("db"), (r) => String(r.sql).slice(0, 90), 5),
  },
  upstream: table(only("upstream"), (r) => r.name, 5),
  snapshot: only("snapshot").map((r) => ({
    name: r.name,
    source: r.source,
    ms: r.ms,
    entities: r.entities,
  })),
  serverRuntime: {
    loopMaxMs: runtime("server").reduce((max, r) => Math.max(max, num(r.loopMax)), 0),
    loopP99Ms: runtime("server").reduce((max, r) => Math.max(max, num(r.loopP99)), 0),
    rssMb: lastOf(runtime("server"), "rssMb"),
  },
  sse: Object.fromEntries(
    [...group(only("sse", "server"), (r) => r.name)].map(([k, v]) => [k, v.length]),
  ),
  redundancy: redundancy(),
  clientFetch: table(
    only("fetch", "client"),
    (r) => `${r.name}${r.failed ? ` (${r.failed})` : ""}`,
  ),
  contentReady: table(only("content", "client"), (r) => String(r.path)),
  cachedGraphs: table(only("graph", "server"), (r) => r.name),
  clientLoads: {
    speculative: stats(loads.filter(speculative)),
    navigation: stats(loads.filter((r) => !speculative(r))),
    byKind: table(loads, (r) => `${r.name}${speculative(r) ? " speculative" : ""}`, 6),
  },
  requestPool: Object.fromEntries([...group(pool, (r) => r.name)].map(([k, v]) => [k, v.length])),
  preload: Object.fromEntries(
    [...group(only("preload"), (r) => r.name)].map(([k, v]) => [k, v.length]),
  ),
  preloadWork: table(
    only("preload").filter((r) => r.ms != null),
    (r) => r.name,
    5,
  ),
  merges: table(only("merge"), (r) => r.name),
  longTasks: { ...stats(longTasks), over100: longTasks.filter((r) => num(r.ms) >= 100).length },
  routes: only("route").map((r) => ({ path: r.name, ms: r.ms })),
  longFrames: only("frame")
    .sort((a, b) => num(b.ms) - num(a.ms))
    .slice(0, 5)
    .map((r) => ({ ms: r.ms, blocking: r.blocking, script: r.script })),
  slowInteractions: only("interaction")
    .sort((a, b) => num(b.ms) - num(a.ms))
    .slice(0, 5)
    .map((r) => ({ type: r.name, ms: r.ms, target: r.target })),
  renders: table(only("render"), (r) => `${r.name}:${r.phase} ${r.path}`, 8),
  slowestRenders: only("render")
    .sort((a, b) => num(b.ms) - num(a.ms))
    .slice(0, 5)
    .map((r) => ({ path: r.path, ms: r.ms, base: r.base })),
  stalls: {
    ...stats(only("stall")),
    byPath: table(only("stall"), (r) => String(r.path), 5),
  },
  // Peak size per collection over the window; a reload empties them, so the last sample misleads.
  collections: runtime("client").reduce<Record<string, number>>((peak, row) => {
    for (const [k, v] of Object.entries(row))
      if (k.startsWith("n_") && typeof v === "number" && v > (peak[k] ?? 0)) peak[k] = v;
    return peak;
  }, {}),
  syncReady: only("sync").map((r) => ({ ms: r.ms, entities: r.entities })),
  browserRuntime: {
    domNodes: lastOf(runtime("client"), "domNodes"),
    heapMb: lastOf(runtime("client"), "heapMb"),
  },
  errors: only("error").map((r) => ({ name: r.name, failed: r.failed })),
  diagnostics: bottlenecks(rows),
};
if (args.includes("--json")) console.log(JSON.stringify(summary, null, 2));
else {
  const show = (title: string, value: unknown) => {
    console.log(`\n## ${title}`);
    console.log(
      typeof value === "string" ? value : JSON.stringify(value, null, 1).replace(/\n\s*/g, " "),
    );
  };
  console.log(`Telemetry ${summary.window.from} → ${summary.window.to} (${rows.length} events)`);
  for (const [title, value] of Object.entries(summary)) if (title !== "window") show(title, value);
}
