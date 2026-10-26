import { safeFields, safeName, safeKind, routeName, type TraceContext } from "../shared/telemetry";
// Local development diagnostics. Everything here is dead code in production builds because
// import.meta.env.DEV is false there. Events go to the dev server, which appends them to
// .local/telemetry/events.ndjson for `bun run telemetry`, and stay readable in the page as
// window.__moviefinderTelemetry for browser-driving agents.
type Fields = Record<string, string | number | boolean | null | undefined>;
type Event = Fields & { t: string; kind: string; name: string };
export const telemetryEnabled = import.meta.env.DEV && typeof window !== "undefined";
const buffer: Event[] = [];
const history: Event[] = [];
const counts: Record<string, number> = {};
const page = crypto.randomUUID();
const nativeFetch = telemetryEnabled ? window.fetch.bind(window) : undefined;
const contexts = new WeakMap<object, TraceContext>();
export const contextFor = (object?: object | null) => (object ? contexts.get(object) : undefined);
export function bindContext<T extends object>(object: T, context?: TraceContext) {
  if (telemetryEnabled && context) contexts.set(object, context);
  return object;
}
const keys = new Map<string, string>();
export function telemetryKey(key: string) {
  if (!telemetryEnabled) return undefined;
  let id = keys.get(key);
  if (!id) {
    if (keys.size >= 2000) keys.delete(keys.keys().next().value!);
    id = crypto.randomUUID();
    keys.set(key, id);
  }
  return id;
}
let navigation:
  | { href: string; context: TraceContext; started: number; resolved: boolean; content?: boolean }
  | undefined;
export function beginNavigation(href: string, click = false) {
  if (!telemetryEnabled) return;
  const absolute = new URL(href, location.origin).href;
  if (navigation?.href === absolute && !navigation.resolved) return;
  if (navigation && !navigation.resolved)
    track("navigation", "interrupted", {
      ...navigation.context,
      ms: performance.now() - navigation.started,
    });
  navigation = {
    href: absolute,
    context: { traceId: crypto.randomUUID() },
    started: performance.now(),
    resolved: false,
  };
  track("navigation", "start", {
    ...navigation.context,
    path: routeName(new URL(absolute).pathname),
    foreground: click,
  });
}
export function bindNavigation(signal: AbortSignal, href: string) {
  if (telemetryEnabled && navigation?.href === new URL(href, location.origin).href)
    bindContext(signal, navigation.context);
}
export function currentNavigationContext() {
  return telemetryEnabled && navigation?.href === location.href ? navigation.context : undefined;
}
export function markNavigationContent(context?: TraceContext) {
  if (
    !telemetryEnabled ||
    !navigation ||
    navigation.content ||
    document.hidden ||
    navigation.href !== location.href ||
    context?.traceId !== navigation.context.traceId
  )
    return;
  navigation.content = true;
  track("content", "ready", {
    ...context,
    path: location.pathname,
    ms: performance.now() - navigation.started,
  });
}
export function resolveNavigation(href: string) {
  if (
    !telemetryEnabled ||
    !navigation ||
    navigation.resolved ||
    navigation.href !== new URL(href, location.origin).href
  )
    return;
  const current = navigation;
  current.resolved = true;
  track("route", routeName(new URL(current.href).pathname), {
    ...current.context,
    ms: performance.now() - current.started,
  });
  track("navigation", "resolved", { ...current.context, ms: performance.now() - current.started });
  // Two animation frames measure the next rendering opportunity, not proof of pixel completeness.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (current === navigation && !document.hidden)
        track("navigation", "paint", {
          ...current.context,
          path: routeName(new URL(current.href).pathname),
          ms: performance.now() - current.started,
        });
    }),
  );
}
const round = (value: number) => Math.round(value * 10) / 10;

const gauges: (() => Fields)[] = [];
// Samplers for state owned elsewhere, e.g. collection sizes. Read every few seconds.
export function gauge(read: () => Fields) {
  if (telemetryEnabled) gauges.push(read);
}
export function track(kind: string, name: string, fields: Fields = {}) {
  if (!telemetryEnabled) return;
  const event: Event = {
    t: new Date().toISOString(),
    kind: safeKind(kind),
    name: safeName(kind, name),
    page,
    ...safeFields(fields),
  };
  if (buffer.length >= 2000) {
    buffer.shift();
    counts["transport.dropped"] = (counts["transport.dropped"] ?? 0) + 1;
  }
  buffer.push(event);
  history.push(event);
  if (history.length > 2000) history.splice(0, history.length - 2000);
  counts[`${event.kind}.${event.name}`] = (counts[`${event.kind}.${event.name}`] ?? 0) + 1;
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
let sending: Promise<void> | undefined;
let drainTimer: ReturnType<typeof setTimeout> | undefined;
async function flush(beacon = false) {
  if (sending) return sending;
  if (!buffer.length || !nativeFetch) return;
  const batch: Event[] = [];
  let bytes = 16;
  while (buffer.length && batch.length < 200) {
    const size = new TextEncoder().encode(JSON.stringify(buffer[0])).byteLength + 1;
    if (bytes + size > 48_000) break;
    bytes += size;
    batch.push(buffer.shift()!);
  }
  if (!batch.length) return;
  const body = JSON.stringify({ events: batch });
  if (
    beacon &&
    navigator.sendBeacon?.("/api/telemetry", new Blob([body], { type: "application/json" }))
  )
    return;
  sending = (async () => {
    let delivered = false;
    try {
      const response = await nativeFetch("/api/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("Telemetry transport failed");
      delivered = true;
    } catch {
      const room = Math.max(0, 2000 - buffer.length);
      buffer.unshift(...batch.slice(0, room));
      counts["transport.retries"] = (counts["transport.retries"] ?? 0) + 1;
      counts["transport.dropped"] =
        (counts["transport.dropped"] ?? 0) + batch.length - Math.min(room, batch.length);
    } finally {
      sending = undefined;
      // Drain bursts in bounded batches instead of leaving them behind a 1.5 s interval.
      // Failed uploads retain the existing retry cadence; only one request is in flight.
      if (delivered && buffer.length && !drainTimer)
        drainTimer = setTimeout(() => {
          drainTimer = undefined;
          void flush();
        }, 50);
    }
  })();
  return sending;
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
let installed = false;
export function installTelemetry() {
  if (!telemetryEnabled || !nativeFetch || installed) return;
  installed = true;
  document.addEventListener(
    "click",
    (event) => {
      if (
        !(event instanceof MouseEvent) ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      )
        return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.download || (link.target && link.target !== "_self")) return;
      const url = new URL(link.href, location.origin);
      if (url.origin === location.origin && url.href !== location.href && !url.hash)
        beginNavigation(url.href, true);
    },
    { capture: true },
  );
  for (const type of [
    "longtask",
    "long-animation-frame",
    "event",
    "layout-shift",
    "largest-contentful-paint",
    "resource",
    "paint",
  ])
    track("observer", "support", {
      resource: type,
      supported:
        typeof PerformanceObserver !== "undefined" &&
        (PerformanceObserver.supportedEntryTypes?.includes(type) ?? false),
    });
  observe("paint", (e) => track("vital", e.name, { ms: e.startTime }));
  observe("largest-contentful-paint", (e) => track("vital", "lcp", { ms: e.startTime }));
  observe("resource", (entry) => {
    const e = entry as PerformanceResourceTiming;
    const url = new URL(e.name, location.origin);
    if (url.pathname === "/api/telemetry" || e.initiatorType === "fetch" || e.duration < 25) return;
    track("resource", "load", {
      ms: e.duration,
      initiator: e.initiatorType,
      transferBytes: e.transferSize,
      encodedBytes: e.encodedBodySize,
      decodedBytes: e.decodedBodySize,
      supported: e.responseStart > 0,
    });
  });
  track("page", "load", { path: location.pathname, hidden: document.hidden });
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
          target: e.target?.tagName.toLowerCase(),
        });
    },
    { durationThreshold: 64 },
  );
  observe("layout-shift", (entry) => {
    const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
    if (!shift.hadRecentInput && shift.value > 0) track("layout", "shift", { value: shift.value });
  });
  const instrumented = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
    if (
      url.origin !== location.origin ||
      !url.pathname.startsWith("/api/") ||
      url.pathname === "/api/telemetry" ||
      url.pathname === "/api/events"
    )
      return nativeFetch(input, init);
    const started = performance.now();
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const context = contextFor(signal) ?? { traceId: crypto.randomUUID() };
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    headers.set("X-Moviefinder-Trace", context.traceId);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const key = telemetryKey(`${method} ${url.href}`);
    try {
      const res = await nativeFetch(input, { ...init, headers });
      const linked = { ...context, requestId: res.headers.get("X-Request-Id") ?? undefined };
      bindContext(res, linked);
      track("fetch", `${method} ${url.pathname}`, {
        ...linked,
        key,
        ms: round(performance.now() - started),
        status: res.status,
        bytes: Number(res.headers.get("content-length")) || undefined,
        query: [...url.searchParams.keys()].join(",") || undefined,
      });
      return res;
    } catch (error) {
      track("fetch", `${method} ${url.pathname}`, {
        ...context,
        key,
        ms: round(performance.now() - started),
        failed: signal?.aborted ? "aborted" : error instanceof Error ? error.name : "error",
        query: [...url.searchParams.keys()].join(",") || undefined,
      });
      throw error;
    }
  };
  window.fetch = Object.assign(instrumented, { preconnect: () => {} }) as typeof fetch;
  window.addEventListener("error", (e) =>
    track("error", "uncaught", { failed: e.error instanceof Error ? e.error.name : "error" }),
  );
  window.addEventListener("unhandledrejection", (e) =>
    track("error", "rejection", {
      failed: e.reason instanceof Error ? e.reason.name : "error",
    }),
  );
  const sample = () => {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    track("runtime", "sample", {
      ...Object.assign({}, ...gauges.map((read) => read())),
      domNodes: document.getElementsByTagName("*").length,
      heapMb: memory ? Math.round(memory.usedJSHeapSize / 1048576) : undefined,
      path: location.pathname,
      buffered: buffer.length,
      dropped: counts["transport.dropped"] ?? 0,
      retries: counts["transport.retries"] ?? 0,
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
      flush: async () => {
        for (let i = 0; i < 20 && (buffer.length || sending); i++) {
          await flush();
        }
      },
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
