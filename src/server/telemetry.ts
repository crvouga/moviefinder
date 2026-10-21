import { appendFileSync, mkdirSync, renameSync, statSync, existsSync } from "node:fs";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { join } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { safeFields, safeName, safeKind, type TraceContext } from "../shared/telemetry";

export type TelemetryFields = Record<string, string | number | boolean | null | undefined>;
export type TelemetryEvent = TelemetryFields & {
  t: string;
  source: "server" | "client";
  kind: string;
  name: string;
};
const maxFileBytes = 20 * 1024 * 1024,
  ringSize = 5000;
let directory: string | undefined;
let pending: string[] = [];
let dropped = 0,
  writeFailures = 0;
let flushTimer: ReturnType<typeof setInterval> | undefined;
let sampler: ReturnType<typeof setInterval> | undefined;
let delayMonitor: ReturnType<typeof monitorEventLoopDelay> | undefined;
const context = new AsyncLocalStorage<TraceContext>();
const muted = new AsyncLocalStorage<boolean>();
export function withoutServerTelemetry<T>(work: () => T): T {
  return muted.run(true, work);
}
export const traceContext = () => (telemetryEnabled() ? context.getStore() : undefined);
export function inTrace<T>(trace: TraceContext, work: () => T): T {
  return telemetryEnabled() ? context.run(trace, work) : work();
}
export function background<T>(work: () => T): T {
  return telemetryEnabled() ? context.run({ traceId: crypto.randomUUID() }, work) : work();
}
const handles = new Map<string, string>();
export function forgetTelemetryKey(key: string) {
  handles.delete(key);
}
export function telemetryKey(key: string) {
  if (!telemetryEnabled()) return undefined;
  let value = handles.get(key);
  if (!value) {
    if (handles.size >= 5000) handles.delete(handles.keys().next().value!);
    value = crypto.randomUUID();
    handles.set(key, value);
  }
  return value;
}
const ring: TelemetryEvent[] = [];

// Local development diagnostics only. Never configured in production; it records timings,
// route templates, and SQL operation/table shapes, but never request bodies, headers, cookies, or SQL parameters.
export function telemetryEnabled() {
  return directory !== undefined && !muted.getStore();
}
export function telemetryFile() {
  return directory ? join(directory, "events.ndjson") : undefined;
}
export function configureTelemetry(target: string | undefined) {
  stopTelemetry();
  directory = target;
  if (!directory) return;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, "events.ndjson");
  if (existsSync(file)) renameSync(file, join(directory, "events.previous.ndjson"));
  flushTimer = setInterval(flushTelemetry, 500);
  flushTimer.unref();
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delayMonitor = delay;
  delay.enable();
  sampler = setInterval(() => {
    const memory = process.memoryUsage();
    record("runtime", "sample", {
      loopP50: round(delay.percentile(50) / 1e6),
      loopP99: round(delay.percentile(99) / 1e6),
      loopMax: round(delay.max / 1e6),
      rssMb: Math.round(memory.rss / 1048576),
      heapMb: Math.round(memory.heapUsed / 1048576),
      dropped,
      retries: writeFailures,
      buffered: pending.length,
    });
    delay.reset();
  }, 5000);
  sampler.unref();
}
export function stopTelemetry() {
  if (flushTimer) clearInterval(flushTimer);
  if (sampler) clearInterval(sampler);
  flushTimer = sampler = undefined;
  delayMonitor?.disable();
  delayMonitor = undefined;
  handles.clear();
  flushTelemetry();
  directory = undefined;
  ring.length = 0;
  pending = [];
  dropped = writeFailures = 0;
}
const round = (value: number) => Math.round(value * 10) / 10;
export function record(
  kind: string,
  name: string,
  fields: TelemetryFields = {},
  source: "server" | "client" = "server",
  at?: string,
) {
  if (!directory || (source === "server" && muted.getStore())) return;
  const event: TelemetryEvent = {
    t:
      at && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at)
        ? at
        : new Date().toISOString(),
    source,
    kind: safeKind(kind),
    name: safeName(kind, name),
    ...safeFields({ ...(source === "server" ? traceContext() : {}), ...fields }),
  };
  ring.push(event);
  if (ring.length > ringSize) ring.splice(0, ring.length - ringSize);
  if (pending.length < 5000) pending.push(JSON.stringify(event));
  else dropped++;
}
export function recentTelemetry() {
  return [...ring];
}
export function flushTelemetry() {
  if (!directory || !pending.length) return;
  const file = join(directory, "events.ndjson");
  try {
    if (existsSync(file) && statSync(file).size > maxFileBytes)
      renameSync(file, join(directory, "events.previous.ndjson"));
    appendFileSync(file, pending.join("\n") + "\n", { mode: 0o600 });
  } catch {
    writeFailures++;
    return; // Retain the bounded batch for a later flush.
  }
  pending = [];
}
export async function timed<T>(
  kind: string,
  name: string,
  work: () => Promise<T>,
  fields: TelemetryFields = {},
) {
  if (!telemetryEnabled()) return work();
  const parent = traceContext();
  const trace = {
    traceId: parent?.traceId ?? crypto.randomUUID(),
    requestId: parent?.requestId,
    parentId: parent?.spanId,
    spanId: crypto.randomUUID(),
  };
  return inTrace(trace, async () => {
    const start = performance.now();
    let failed = false;
    try {
      return await work();
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      record(kind, name, { ...fields, failed, ms: round(performance.now() - start) });
    }
  });
}
