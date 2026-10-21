import { afterEach, describe, expect, it } from "vite-plus/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configureTelemetry,
  flushTelemetry,
  recentTelemetry,
  record,
  stopTelemetry,
  telemetryEnabled,
  timed,
} from "../../src/server/telemetry";
import { readConfig } from "../../src/server/config";

const base = { DATABASE_URL: "postgres://x", BETTER_AUTH_SECRET: "s".repeat(32) };
let directory: string | undefined;
afterEach(async () => {
  stopTelemetry();
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});
describe("local development telemetry", () => {
  it("records nothing unless a directory is configured", () => {
    record("http", "GET /api/state", { ms: 1 });
    expect(telemetryEnabled()).toBe(false);
    expect(recentTelemetry()).toEqual([]);
  });
  it("appends newline-delimited events with durations and client origin", async () => {
    directory = await mkdtemp(join(tmpdir(), "moviefinder-telemetry-"));
    configureTelemetry(directory);
    await timed("snapshot", "state", async () => "done", { entities: 3 });
    record("longtask", "task", { ms: 120 }, "client", "2026-01-01T00:00:00.000Z");
    flushTelemetry();
    const lines = (await readFile(join(directory, "events.ndjson"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ source: "server", kind: "snapshot", entities: 3 });
    expect(typeof lines[0].ms).toBe("number");
    expect(lines[1]).toMatchObject({ source: "client", t: "2026-01-01T00:00:00.000Z" });
  });
  it("keeps the previous run when a new run starts", async () => {
    directory = await mkdtemp(join(tmpdir(), "moviefinder-telemetry-"));
    configureTelemetry(directory);
    record("http", "GET /api/state", {});
    flushTelemetry();
    configureTelemetry(directory);
    expect(await readFile(join(directory, "events.previous.ndjson"), "utf8")).toContain(
      "GET /api/state",
    );
  });
  it("is refused in production", () => {
    expect(() =>
      readConfig({
        ...base,
        NODE_ENV: "production",
        MOVIEFINDER_ORIGIN: "https://example.test",
        MOVIEFINDER_TELEMETRY_DIR: ".local/telemetry",
      }),
    ).toThrow("local development only");
    expect(readConfig({ ...base, MOVIEFINDER_TELEMETRY_DIR: ".local/telemetry" })).toBeTruthy();
  });
});

describe("trace correlation and privacy", () => {
  it("keeps concurrent request and nested span contexts separate", async () => {
    const { inTrace } = await import("../../src/server/telemetry");
    directory = await mkdtemp(join(tmpdir(), "moviefinder-traces-"));
    configureTelemetry(directory);
    const a = {
      traceId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      spanId: crypto.randomUUID(),
    };
    const b = {
      traceId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      spanId: crypto.randomUUID(),
    };
    await Promise.all(
      [a, b].map((context) =>
        inTrace(context, () =>
          timed("snapshot", "state", async () => {
            await Promise.resolve();
            record("db", "query", { ms: 2 });
          }),
        ),
      ),
    );
    const events = recentTelemetry();
    for (const context of [a, b]) {
      const query = events.find(
        (event) => event.kind === "db" && event.traceId === context.traceId,
      )!;
      const parent = events.find(
        (event) => event.kind === "snapshot" && event.traceId === context.traceId,
      )!;
      expect(query.requestId).toBe(context.requestId);
      expect(query.spanId).toBe(parent.spanId);
      expect(parent.parentId).toBe(context.spanId);
      expect(parent.failed).toBe(false);
    }
  });
  it("records failures without retaining exception messages or private fields", async () => {
    directory = await mkdtemp(join(tmpdir(), "moviefinder-private-"));
    configureTelemetry(directory);
    await expect(
      timed("snapshot", "state", async () => {
        throw new Error("private@example.test");
      }),
    ).rejects.toThrow();
    record(
      "error",
      "uncaught",
      {
        message: "private@example.test",
        query: "private@example.test",
        key: "private@example.test",
        path: "/profile/private@example.test?q=private",
        sql: "select 'private@example.test' from moviefinder.source_entity",
        token: "private@example.test",
      },
      "client",
    );
    flushTelemetry();
    const text = await readFile(join(directory, "events.ndjson"), "utf8");
    expect(text).not.toContain("private@example.test");
    expect(text).toContain('"path":"/profile/:id"');
    expect(recentTelemetry()[0]?.failed).toBe(true);
  });
});

it("excludes diagnostics upload work while accepting the client events it carries", async () => {
  const { withoutServerTelemetry } = await import("../../src/server/telemetry");
  directory = await mkdtemp(join(tmpdir(), "moviefinder-upload-"));
  configureTelemetry(directory);
  await withoutServerTelemetry(async () => {
    expect(telemetryEnabled()).toBe(false);
    record("db", "query", { ms: 1 });
    record("runtime", "sample", { ms: 2 }, "client");
    await timed("snapshot", "state", async () => "done");
  });
  expect(telemetryEnabled()).toBe(true);
  expect(recentTelemetry()).toMatchObject([{ source: "client", kind: "runtime" }]);
});
