import { appendFileSync, mkdirSync, renameSync, statSync, existsSync } from "node:fs";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { join } from "node:path";

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
let flushTimer: ReturnType<typeof setInterval> | undefined;
let sampler: ReturnType<typeof setInterval> | undefined;
const ring: TelemetryEvent[] = [];

// Local development diagnostics only. Never configured in production; it records timings,
// route names, and SQL text, but never request bodies, headers, cookies, or SQL parameters.
export function telemetryEnabled() {
  return directory !== undefined;
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
  delay.enable();
  sampler = setInterval(() => {
    const memory = process.memoryUsage();
    record("runtime", "sample", {
      loopP50: round(delay.percentile(50) / 1e6),
      loopP99: round(delay.percentile(99) / 1e6),
      loopMax: round(delay.max / 1e6),
      rssMb: Math.round(memory.rss / 1048576),
      heapMb: Math.round(memory.heapUsed / 1048576),
    });
    delay.reset();
  }, 5000);
  sampler.unref();
}
export function stopTelemetry() {
  if (flushTimer) clearInterval(flushTimer);
  if (sampler) clearInterval(sampler);
  flushTimer = sampler = undefined;
  flushTelemetry();
  directory = undefined;
  ring.length = 0;
}
const round = (value: number) => Math.round(value * 10) / 10;
export function record(
  kind: string,
  name: string,
  fields: TelemetryFields = {},
  source: "server" | "client" = "server",
  at?: string,
) {
  if (!directory) return;
  const event: TelemetryEvent = {
    t: at ?? new Date().toISOString(),
    source,
    kind,
    name,
    ...fields,
  };
  ring.push(event);
  if (ring.length > ringSize) ring.splice(0, ring.length - ringSize);
  pending.push(JSON.stringify(event));
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
    // Diagnostics must never affect the application.
  }
  pending = [];
}
export async function timed<T>(
  kind: string,
  name: string,
  work: () => Promise<T>,
  fields: TelemetryFields = {},
) {
  const start = performance.now();
  try {
    return await work();
  } finally {
    record(kind, name, { ...fields, ms: round(performance.now() - start) });
  }
}
