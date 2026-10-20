# Local observability

Diagnostics for local development only. `bun run dev` records timings from the Bun server and the
browser into one newline-delimited file, `.local/telemetry/events.ndjson` (ignored by Git). The
previous run is kept as `events.previous.ndjson`; files rotate at 20 MB. Production never sets
`MOVIEFINDER_TELEMETRY_DIR` (configuration refuses it), the browser code is removed from production
builds, and `/api/telemetry` is not registered unless telemetry is configured.

Events carry timings, route names, SQL text and query-parameter names. They never carry request or
response bodies, headers, cookies, query-parameter values or SQL parameters.

## Reading it (humans and agents)

```sh
bun run telemetry                      # summary of everything recorded
bun run telemetry --since 5m           # only the last five minutes
bun run telemetry --json               # the same summary, machine readable
bun run telemetry tail --kind fetch    # raw events, filter by --kind / --name, -n 40
bun run telemetry slow --min 50        # slowest events first
bun run telemetry clear                # start a clean measurement
```

The summary covers server HTTP latency and size per route, database statements (slowest and most
repeated), TMDB requests, snapshot size, event-loop lag, SSE traffic, browser fetches (including
aborted ones), the request pool (requests, joins, cancellations), preload activity, collection
merge cost, long tasks and long animation frames with the responsible script, slow interactions,
React commit time per screen, route transitions, DOM size and heap, and uncaught errors.

In a page opened with `bun run dev`, `window.__moviefinderTelemetry` exposes `events`, `counts`,
`summary()` and `flush()` for a browser-driving agent. `counts["render.useEntities.<kind>"]` shows
how often each collection hook ran.

## Reproducible performance run

```sh
bun run perf                 # 2000 synthetic titles, 4x CPU throttle
bun run perf --throttle 1    # no throttle
bun run perf --titles 5000 --json
```

`bun run perf` creates an isolated embedded PostgreSQL, serves a synthetic catalog 20 titles per
page with provider latency, runs the real Vite client in headless Chromium, registers, scrolls 30
slides, tags, opens a title, visits lists and search, then prints the telemetry summary. Compare
`longTasks`, `renders`, `requestPool` and `clientFetch` before and after a change. It makes no
network requests and never touches the local development database.

## Adding instrumentation

Browser: `track(kind, name, fields)`, `span(kind, name, work)` and `measure(kind, name, work, fields,
minMs)` from `src/client/telemetry.ts`. Server: `record(kind, name, fields)` and `timed(...)` from
`src/server/telemetry.ts`. Keep field values primitive and free of personal data.
