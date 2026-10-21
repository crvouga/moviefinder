import { describe, it, expect } from "vite-plus/test";
import { readRows, traces, bottlenecks, type Row } from "../../scripts/telemetry-report";
import { safeFields, sqlShape, safeName } from "../../src/shared/telemetry";
const row = (fields: Partial<Row>): Row => ({
  t: "2026-10-20T00:00:00.000Z",
  source: "client",
  kind: "navigation",
  name: "start",
  ...fields,
});
describe("performance reports", () => {
  it("links adopted speculative work and shared jobs without attaching concurrent unrelated work", () => {
    const navigation = crypto.randomUUID(),
      preload = crypto.randomUUID(),
      worker = crypto.randomUUID(),
      job = crypto.randomUUID();
    const rows = [
      row({ traceId: navigation, path: "/title/:id" }),
      row({ traceId: navigation, name: "paint", ms: 240 }),
      row({ traceId: navigation, kind: "pool", name: "join", workId: preload, adopted: true }),
      row({ traceId: preload, kind: "job-wait", name: "settled", workId: job, ms: 180 }),
      row({ traceId: worker, kind: "job", name: "run", workId: job, ms: 170 }),
      row({ traceId: worker, kind: "upstream", name: "GET /person/:id", ms: 150 }),
      row({ traceId: crypto.randomUUID(), kind: "db", name: "query", ms: 900 }),
    ];
    const result = traces(rows)[0]!;
    expect(result.linkedTraces).toBe(2);
    expect(result.kinds).toContain("upstream");
    expect(result.kinds).not.toContain("db");
    expect(result.paintMs).toBe(240);
    expect(bottlenecks(rows).slowestStages[0]?.maxMs).toBe(900);
  });
  it("redacts older recordings, ignores truncated records and respects the requested time window", () => {
    const text =
      JSON.stringify(
        row({
          kind: "fetch",
          name: "GET /api/profile/private@example.test?q=secret",
          message: "secret",
          key: "discover:secret",
          ms: 20,
        }),
      ) + '\n{"truncated":';
    expect(readRows(text)).toEqual([row({ kind: "fetch", name: "GET /api/profile/:id", ms: 20 })]);
    expect(readRows(text, Date.parse("2026-10-21"))).toEqual([]);
    expect(safeName("error", "private@example.test")).toBe("event");
  });
  it("retains only safe SQL operation/table shapes and primitive performance fields", () => {
    const sql =
      "select 'private@example.test', $$secret$$, $1 from moviefinder.source_entity /* secret */ where title='secret'";
    const safe = safeFields({
      sql,
      ms: 25,
      authorization: "secret",
      id: "private",
      query: "secret",
      rows: 3,
      bad: Infinity,
    });
    expect(safe).toEqual({ sql: "SELECT source_entity", ms: 25, rows: 3 });
    expect(sqlShape(String(safe.sql))).toBe(safe.sql);
    expect(sqlShape("select '--secret' from moviefinder.unknown_private_table")).toBe("SELECT");
  });
});

it("inspects command/request traces even when they are not route transitions", () => {
  const traceId = crypto.randomUUID(),
    requestId = crypto.randomUUID();
  const rows = [
    row({ traceId, requestId, kind: "fetch", name: "POST /api/command", ms: 40 }),
    row({ source: "server", traceId, requestId, kind: "db", name: "query", ms: 20 }),
  ];
  const trace = traces(rows, traceId)[0]!;
  expect(trace.path).toBe("/api/command");
  expect(trace.kinds).toEqual(["fetch", "db"]);
  expect(trace.resolvedMs).toBeUndefined();
});

it("reports a long session without expanding every event into function arguments", () => {
  const event = row({ source: "server", kind: "db", name: "query", ms: 2, dropped: 1 });
  const report = bottlenecks(Array<Row>(150_000).fill(event));
  expect(report.slowestStages[0]).toMatchObject({ count: 150_000, maxMs: 2 });
  expect(report.coverage.droppedEventsPeak).toBe(1);
});

it("follows shared producers without pulling another consumer's navigation into the trace", () => {
  const a = crypto.randomUUID(),
    b = crypto.randomUUID(),
    work = crypto.randomUUID();
  const rows = [
    row({ traceId: a, path: "/title/:id" }),
    row({ traceId: a, kind: "pool", name: "request", workId: work }),
    row({ traceId: a, name: "paint", ms: 1000 }),
    row({ traceId: b, path: "/lists" }),
    row({ traceId: b, kind: "pool", name: "join", workId: work }),
    row({ traceId: b, name: "paint", ms: 50 }),
    row({ traceId: work, kind: "fetch", name: "GET /api/title/:id", ms: 800 }),
  ];
  const trace = traces(rows, b)[0]!;
  expect(trace.linkedTraces).toBe(1);
  expect(trace.stages.some((stage) => stage.traceId === a)).toBe(false);
  expect(trace.stages.find((stage) => stage.kind === "fetch")).toMatchObject({
    shared: true,
    ms: 800,
  });
});
