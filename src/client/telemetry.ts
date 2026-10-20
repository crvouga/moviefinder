// Local development diagnostics. Everything here is dead code in production builds because
// import.meta.env.DEV is false there. Events go to the dev server, which appends them to
// .local/telemetry/events.ndjson for `bun run telemetry`, and stay readable in the page as
// window.__moviefinderTelemetry for browser-driving agents.
type Fields = Record<string, string | number | boolean | null | undefined>;
type Event = Fields & { t: string; kind: string; name: string };
export const telemetryEnabled = import.meta.env.DEV;
const buffer: Event[] = [];
const history: Event[] = [];
const counts: Record<string, number> = {};
const page = crypto.randomUUID().slice(0, 8);
const nativeFetch = telemetryEnabled ? window.fetch.bind(window) : undefined;
const round = (value: number) => Math.round(value * 10) / 10;

const gauges: (() => Fields)[] = [];
// Samplers for state owned elsewhere, e.g. collection sizes. Read every few seconds.
export function gauge(read: () => Fields) {
  if (telemetryEnabled) gauges.push(read);
}
export function track(kind: string, name: string, fields: Fields = {}) {
  if (!telemetryEnabled) return;
  const event: Event = { t: new Date().toISOString(), kind, name, page, ...fields };
  buffer.push(event);
  history.push(event);
  if (history.length > 2000) history.splice(0, history.length - 2000);
  counts[`${kind}.${name}`] = (counts[`${kind}.${name}`] ?? 0) + 1;
}
export function count(name: string, by = 1) {
  if (telemetryEnabled) counts[name] = (counts[name] ?? 0) + by;
}
export async function span<T>(kind: string, name: string, work: () => Promise<T>, fields?: Fields) {
  if (!telemetryEnabled) return work();
  const started = performance.now();
  try {
    const result = await work();
    track(kind, name, { ...fields, ms: round(performance.now() - started) });
    return result;
  } catch (error) {
    track(kind, name, {
      ...fields,
      ms: round(performance.now() - started),
      failed: error instanceof Error ? error.name : "error",
    });
    throw error;
  }
}
export function measure<T>(kind: string, name: string, work: () => T, fields?: Fields, min = 4) {
  if (!telemetryEnabled) return work();
  const started = performance.now();
  const result = work();
  const ms = performance.now() - started;
  if (ms >= min) track(kind, name, { ...fields, ms: round(ms) });
  return result;
}
function flush(beacon = false) {
  if (!buffer.length || !nativeFetch) return;
  const body = JSON.stringify({ events: buffer.splice(0, 500) });
  if (
    beacon &&
    navigator.sendBeacon?.("/api/telemetry", new Blob([body], { type: "application/json" }))
  )
    return;
  void nativeFetch("/api/telemetry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}
function observe(type: string, handle: (entry: PerformanceEntry) => void, extra = {}) {
  try {
    new PerformanceObserver((list) => list.getEntries().forEach(handle)).observe({
      type,
      buffered: true,
      ...extra,
    });
  } catch {
    /* Entry type unsupported in this browser. */
  }
}
export function installTelemetry() {
  if (!telemetryEnabled || !nativeFetch) return;
  track("page", "load", { path: location.pathname, agent: navigator.userAgent.slice(0, 80) });
  observe("longtask", (e) =>
    track("longtask", "task", { ms: round(e.duration), at: round(e.startTime) }),
  );
  observe("long-animation-frame", (entry) => {
    const frame = entry as PerformanceEntry & {
      blockingDuration?: number;
      scripts?: {
        sourceURL?: string;
        sourceFunctionName?: string;
        invoker?: string;
        duration: number;
      }[];
    };
    const worst = [...(frame.scripts ?? [])].sort((a, b) => b.duration - a.duration)[0];
    track("frame", "long", {
      ms: round(entry.duration),
      blocking: round(frame.blockingDuration ?? 0),
      script: worst
        ? `${worst.invoker ?? ""} ${worst.sourceFunctionName ?? ""} ${(worst.sourceURL ?? "").replace(location.origin, "")}`
            .trim()
            .slice(0, 200)
        : undefined,
      scriptMs: worst ? round(worst.duration) : undefined,
    });
  });
  observe(
    "event",
    (entry) => {
      const e = entry as PerformanceEntry & { interactionId?: number; target?: Element };
      if (e.interactionId)
        track("interaction", entry.name, {
          ms: round(entry.duration),
          target:
            e.target?.tagName.toLowerCase() +
            (e.target?.className ? `.${String(e.target.className).split(" ")[0]}` : ""),
        });
    },
    { durationThreshold: 64 },
  );
  observe("layout-shift", (entry) => {
    const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
    if (!shift.hadRecentInput && shift.value > 0.02)
      track("layout", "shift", { value: round(shift.value * 1000) / 1000 });
  });
  const instrumented = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
    if (
      !url.pathname.startsWith("/api/") ||
      url.pathname === "/api/telemetry" ||
      url.pathname === "/api/events"
    )
      return nativeFetch(input, init);
    const started = performance.now();
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    try {
      const res = await nativeFetch(input, init);
      track("fetch", `${init?.method ?? "GET"} ${url.pathname}`, {
        ms: round(performance.now() - started),
        status: res.status,
        bytes: Number(res.headers.get("content-length")) || undefined,
        query: [...url.searchParams.keys()].join(",") || undefined,
      });
      return res;
    } catch (error) {
      track("fetch", `${init?.method ?? "GET"} ${url.pathname}`, {
        ms: round(performance.now() - started),
        failed: signal?.aborted ? "aborted" : error instanceof Error ? error.name : "error",
        query: [...url.searchParams.keys()].join(",") || undefined,
      });
      throw error;
    }
  };
  window.fetch = Object.assign(instrumented, { preconnect: () => {} }) as typeof fetch;
  window.addEventListener("error", (e) =>
    track("error", "uncaught", { message: String(e.message).slice(0, 300) }),
  );
  window.addEventListener("unhandledrejection", (e) =>
    track("error", "rejection", {
      message: String((e.reason as Error)?.message ?? e.reason).slice(0, 300),
    }),
  );
  const sample = () => {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    track("runtime", "sample", {
      ...Object.assign({}, ...gauges.map((read) => read())),
      domNodes: document.getElementsByTagName("*").length,
      heapMb: memory ? Math.round(memory.usedJSHeapSize / 1048576) : undefined,
      path: location.pathname,
    });
  };
  setInterval(sample, 5000);
  // Long-task entries are missing in WebKit/Firefox, so detect main-thread stalls by timer lateness.
  let tick = performance.now();
  setInterval(() => {
    const now = performance.now(),
      late = now - tick - 50;
    tick = now;
    if (late >= 100 && !document.hidden)
      track("stall", "main", { ms: round(late), path: location.pathname });
  }, 50);
  document.addEventListener("visibilitychange", () => (tick = performance.now()));
  setInterval(() => flush(), 1500);
  addEventListener("pagehide", () => flush(true));
  document.addEventListener("visibilitychange", () => document.hidden && flush(true));
  Object.assign(window, {
    __moviefinderTelemetry: {
      events: history,
      counts,
      flush: () => flush(),
      summary: () => summarize(history),
    },
  });
}
export function summarize(events: Event[]) {
  const long = events.filter((e) => e.kind === "longtask");
  const fetches = events.filter((e) => e.kind === "fetch");
  return {
    longTasks: {
      count: long.length,
      totalMs: Math.round(long.reduce((n, e) => n + Number(e.ms), 0)),
      maxMs: Math.max(0, ...long.map((e) => Number(e.ms))),
    },
    fetches: fetches.length,
    counts,
  };
}
