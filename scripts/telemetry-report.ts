import { safeFields, safeName, safeKind } from "../src/shared/telemetry";
export type Row = Record<string, string | number | boolean | null | undefined> & {
  t: string;
  source: string;
  kind: string;
  name: string;
};
export function readRows(text: string, cutoff = 0): Row[] {
  const rows = text.split("\n").flatMap((line) => {
    try {
      const row = JSON.parse(line) as Row;
      if (
        typeof row.t !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.t) ||
        !Number.isFinite(Date.parse(row.t)) ||
        Date.parse(row.t) < cutoff ||
        typeof row.kind !== "string" ||
        typeof row.name !== "string"
      )
        return [];
      return [
        {
          t: row.t,
          source: row.source === "client" ? "client" : "server",
          kind: safeKind(row.kind),
          name: safeName(row.kind, row.name),
          ...safeFields(row),
        },
      ];
    } catch {
      return [];
    }
  });
  return rows.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
}
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const round = (value: number) => Math.round(value * 10) / 10;
export function timings(rows: Row[]) {
  const sorted = rows.map((row) => number(row.ms)).sort((a, b) => a - b);
  return {
    count: rows.length,
    totalMs: round(sorted.reduce((sum, ms) => sum + ms, 0)),
    p50: round(sorted[Math.floor(sorted.length * 0.5)] ?? 0),
    p95: round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0),
    maxMs: round(sorted.at(-1) ?? 0),
  };
}
export function traces(rows: Row[], traceId?: string) {
  const starts = rows.filter(
    (row) =>
      row.kind === "navigation" && row.name === "start" && (!traceId || row.traceId === traceId),
  );
  if (traceId && !starts.length) {
    const request = rows.find(
      (row) => row.traceId === traceId && ["fetch", "http"].includes(row.kind),
    );
    if (request)
      starts.push({
        ...request,
        kind: "navigation",
        name: "start",
        path: request.name.replace(/^[A-Z]+ /, ""),
      });
  }
  return starts.slice(-20).map((start) => {
    const ids = new Set([start.traceId]);
    const work = new Set<string | number | boolean | null | undefined>();
    // Shared preloads and durable jobs are linked explicitly, never inferred from time overlap.
    for (let pass = 0; pass < 8; pass++) {
      let added = false;
      for (const row of rows) {
        if (ids.has(row.traceId) && row.workId && !work.has(row.workId)) {
          work.add(row.workId);
          added = true;
        }
        if (
          (work.has(row.traceId) ||
            (row.kind === "job" && row.name === "run" && work.has(row.workId))) &&
          row.traceId &&
          !ids.has(row.traceId)
        ) {
          ids.add(row.traceId);
          added = true;
        }
      }
      if (!added) break;
    }
    const linked = rows.filter((row) => ids.has(row.traceId));
    const own = linked.filter((row) => row.traceId === start.traceId);
    const paint = own.find((row) => row.kind === "navigation" && row.name === "paint");
    const resolved = own.find((row) => row.kind === "navigation" && row.name === "resolved");
    return {
      traceId: start.traceId,
      path: start.path,
      at: start.t,
      paintMs: paint?.ms,
      contentMs: own.find((row) => row.kind === "content" && row.name === "ready")?.ms,
      resolvedMs: resolved?.ms,
      interrupted: own.some((row) => row.kind === "navigation" && row.name === "interrupted"),
      linkedTraces: ids.size - 1,
      kinds: [...new Set(linked.map((row) => row.kind))],
      stages: linked
        .filter(
          (row) =>
            typeof row.ms === "number" &&
            (!["navigation", "route"].includes(row.kind) || row.traceId === start.traceId),
        )
        .sort((a, b) => number(b.ms) - number(a.ms))
        .slice(0, 30)
        .map((row) => ({
          source: row.source,
          shared: row.traceId !== start.traceId,
          historical: Date.parse(row.t) < Date.parse(start.t),
          t: row.t,
          kind: row.kind,
          name: row.name,
          ms: round(number(row.ms)),
          requestId: row.requestId,
          traceId: row.traceId,
          workId: row.workId,
          sql: row.sql,
          failed: row.failed,
          queueMs: row.queueMs,
          speculative: row.speculative,
        })),
    };
  });
}
export function bottlenecks(rows: Row[]) {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    if (typeof row.ms !== "number" || (row.kind === "navigation" && row.name !== "paint")) continue;
    const key = `${row.source} ${row.kind} ${row.name}${row.sql ? " " + row.sql : ""}`;
    const held = groups.get(key) ?? [];
    held.push(row);
    groups.set(key, held);
  }
  return {
    window: { events: rows.length, from: rows[0]?.t, to: rows.at(-1)?.t },
    note: "Durations overlap. Totals are work volume, not an additive critical path. Paint is the next rendering opportunity; it does not prove visual completeness. Shared preload/job links may precede the click. Zero cross-origin resource sizes can mean unavailable timing, not a cache hit.",
    slowestStages: [...groups]
      .map(([stage, items]) => ({ stage, ...timings(items) }))
      .sort((a, b) => b.maxMs - a.maxMs)
      .slice(0, 20),
    slowestNavigations: traces(rows)
      .sort((a, b) => number(b.paintMs ?? b.resolvedMs) - number(a.paintMs ?? a.resolvedMs))
      .slice(0, 5),
    failures: rows
      .filter(
        (row) => row.failed === true || typeof row.failed === "string" || number(row.status) >= 400,
      )
      .map((row) => ({
        kind: row.kind,
        name: row.name,
        status: row.status,
        failed: row.failed,
        requestId: row.requestId,
        traceId: row.traceId,
      }))
      .slice(-20),
    preload: {
      completed: rows.filter(
        (row) => row.kind === "pool" && row.name === "complete" && row.speculative,
      ).length,
      adopted: rows.filter((row) => row.kind === "pool" && row.name === "join" && row.adopted)
        .length,
      cancelled: rows.filter((row) => row.kind === "pool" && row.name === "cancel").length,
    },
    coverage: {
      browser: rows.some((row) => row.source === "client"),
      server: rows.some((row) => row.kind === "http"),
      database: rows.some((row) => row.kind === "db"),
      provider: rows.some((row) => row.kind === "upstream"),
      navigation: rows.some((row) => row.kind === "navigation"),
      droppedEventsPeak: rows.reduce((max, row) => Math.max(max, number(row.dropped)), 0),
      unsupportedObservers: rows.filter((row) => row.kind === "observer" && row.supported === false)
        .length,
    },
  };
}

export function formatTraces(items: ReturnType<typeof traces>, detailed = false) {
  if (!items.length)
    return "No navigation traces in this window. Browse with the development client.";
  return items
    .slice(detailed ? 0 : -5)
    .map((trace) =>
      [
        `${trace.path}  resolve ${trace.resolvedMs ?? "pending"} ms  next paint ${trace.paintMs ?? "pending"} ms  visible data ${trace.contentMs ?? "unmeasured"} ms${trace.interrupted ? "  interrupted" : ""}`,
        `  trace ${trace.traceId}  shared links ${trace.linkedTraces}`,
        ...trace.stages
          .slice(0, detailed ? 30 : 6)
          .map(
            (stage) =>
              `  ${String(stage.ms).padStart(8)} ms  ${stage.source} ${stage.kind} ${stage.name}${stage.sql ? " " + stage.sql : ""}${stage.shared ? (stage.historical ? " [shared earlier]" : " [shared work]") : ""}${stage.requestId ? "  request " + stage.requestId : ""}`,
          ),
      ].join("\n"),
    )
    .join("\n\n");
}
export function formatBottlenecks(report: ReturnType<typeof bottlenecks>) {
  return [
    `Local performance: ${report.window.events} events  ${report.window.from ?? "waiting"} → ${report.window.to ?? "waiting"}`,
    `Coverage: ${Object.entries(report.coverage)
      .filter(([key]) => !["droppedEventsPeak", "unsupportedObservers"].includes(key))
      .map(([key, value]) => `${key}=${value ? "yes" : "no"}`)
      .join("  ")}`,
    `Dropped events (peak sampled counter) ${report.coverage.droppedEventsPeak}; unsupported observer samples ${report.coverage.unsupportedObservers}`,
    "\nSlowest stages (max / p95 milliseconds; overlapping durations):",
    ...report.slowestStages
      .slice(0, 12)
      .map(
        (stage) =>
          `  ${String(stage.maxMs).padStart(8)} / ${String(stage.p95).padStart(7)}  n=${String(stage.count).padEnd(5)} ${stage.stage}`,
      ),
    `\nPreloads completed ${report.preload.completed}, adoption interests ${report.preload.adopted}, cancellations ${report.preload.cancelled}. Recent failures ${report.failures.length}.`,
    "\nRecent slow navigations:",
    formatTraces(report.slowestNavigations),
    "\nUse telemetry traces --trace UUID for details; --json retains all report fields. Paint denotes the next rendering opportunity, not pixel completeness.",
  ].join("\n");
}
