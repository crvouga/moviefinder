# Local observability

`bun run dev` and `bun run dev:local` automatically record the Bun server and development browser
into ignored `.local/telemetry/events.ndjson`. Browse normally; no browser extension or external
collector is needed. The development launcher watches server code and Vite reloads client code.
Production configuration refuses `MOVIEFINDER_TELEMETRY_DIR`, and the production browser does not
install instrumentation or expose `window.__moviefinderTelemetry`.

## Find a slowdown while browsing

```sh
bun run telemetry watch --since 5m       # refresh the recent bottleneck report every two seconds
bun run telemetry bottlenecks --since 5m # one report, ranked by measured maximum stage duration
bun run telemetry traces --since 5m      # navigation traces, including adopted preloads/jobs
bun run telemetry traces --trace UUID   # inspect a navigation or request trace from a report
bun run telemetry --since 5m            # full aggregate summary
bun run telemetry --json                # machine-readable aggregate summary
bun run telemetry tail --kind db -n 40  # individual events (also supports --name)
bun run telemetry slow --min 50         # slowest events first
bun run telemetry clear                 # remove the current recording
```

Start `watch` in another terminal while using the app. It defaults to a rolling five-minute window.
Use `traces` after a slow navigation to see the requests and preparation stages attached to it.
The report lists coverage and unsupported browser observers so missing measurements remain visible.
Trace reports retain the 30 slowest timed stages of each of the 20 most recent navigations; selecting
a trace ID also supports older navigation or request traces within the chosen window. Raw recorded
events remain available through `tail`, `slow`, and the NDJSON file.
Repeated identical reads are identified with opaque per-page keys; they can represent intentional
refreshes, so repetition alone does not prove wasted work. Older recordings lack those keys and
cannot establish request equality.

## What is measured

| Layer                | Measurements                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation           | Link click or router start, resolution, interruption, next paint opportunity                                                                   |
| Visible content      | `content.ready` and trace `contentMs`: first-screen detail data committed with visible references available; images are timed separately       |
| Cached graphs        | Bounded neighbour-graph SQL duration, total entities and included preview count                                                                |
| Preparation          | Optional background preparation, collection readiness, data loads and critical artwork                                                         |
| Request pool         | Cache joins, speculative adoption, cancellation, queue delay and completion                                                                    |
| Browser HTTP         | Time to headers, status, available response size, request/server correlation                                                                   |
| Response handling    | Body transfer plus JSON parsing, canonical collection commit duration                                                                          |
| Server HTTP          | Handler duration and status; `Server-Timing: app` in local responses                                                                           |
| PostgreSQL           | Connection acquisition wait, busy/waiting connections, statement shapes, rows and failures                                                     |
| Sync worker          | Enqueue, due-to-start delay, execution, completion wait, retries and terminal failure                                                          |
| Provider             | Whole provider call, including throttling/body parsing; real TMDB calls also record headers and parse separately                               |
| Images               | Native image display completion, preparation, consumer wait/cache reuse, download/decode time, failures/timeouts/cancellation                  |
| Browser rendering    | React commits, long tasks, long animation frames, event interaction latency, layout shifts, FCP/LCP entries, resource timings and timer stalls |
| Live updates/runtime | SSE batches/replay, peak collection sizes, DOM nodes, available heap, server event-loop lag and memory                                         |
| Diagnostics          | Observer support, browser buffered/dropped events and upload retries                                                                           |

Random trace IDs flow through abort signals and pooled reads to a development-only request header.
Request trace IDs also work with `traces --trace` for commands and other reads.
The response request ID joins the browser fetch/body/merge with the precise server request and SQL.
Server async context keeps concurrent requests separate. Shared speculative reads and worker jobs
use explicit opaque links. Each pooled request and decoded image has its own work context; links
follow producers and exclude other consumers of the same work. Worker polling starts a separate context. No trace is attached to other
work merely because it happened nearby in time.

Timings overlap: a server request can contain worker waiting, provider calls and SQL. Do **not** add
these durations as a critical path. Shared preloads may start before the click; the report marks completed earlier work as `[shared earlier]`. `navigation.paint`
is a second animation-frame callback after resolution, measuring the next rendering opportunity;
it measures destination opening, independently of data and image readiness. Data effects remain
linked to that navigation after resolution, and `image.display` records native image completion.
`content.ready` records the next rendering opportunity after first-screen detail data and its
visible references are available, including a bounded neighbour preview. It does not require the
full filmography, below-fold data, artwork or a fresh provider response. `traces` shows this
separately as visible-data timing; summary JSON includes `contentReady` and `cachedGraphs`.
These stages can finish after `navigation.paint`; paint does not prove every pixel is complete. React commits, live updates, resource timings and timer
stalls are session measurements, not causally attributed to one navigation. Body timing includes
remaining transfer and JSON parsing. Cross-origin resource sizes may be unavailable without timing
permission; zero bytes do not establish a cache hit. Unsupported performance entry types are
reported, and timer-stall detection covers browsers without long-task entries. These are diagnostic
entries, not a certified Core Web Vitals score or a guarantee of zero lag.

## Privacy and overhead

Only allowlisted timing/count fields, static labels, route templates, random correlation IDs and SQL
operation/table shapes are retained. Search text, user/profile/list IDs, URLs, query values, error
messages, headers, cookies, bodies, SQL literals and bound parameters are excluded. Both browser
capture and server ingestion apply this boundary; the reader also redacts older recordings.
Existing files from older versions are not rewritten. SQL shapes deliberately omit statement text.

The browser retains at most 2,000 events and uploads batches of at most 200 events below 48 KB,
retrying failed uploads. Successful uploads drain remaining bursts with a 50 ms yield between
batches, with only one request in flight, so graph/image diagnostics do not accumulate behind the
normal 1.5 second sampling interval.
The server bounds its in-memory ring and pending queue at 5,000 events each. Files rotate at 20 MB,
keeping one previous file/run, with private file permissions. Diagnostics never read or clone
response bodies on the server. Their own upload/authentication work is excluded from server timings
and SQL counts so collection does not inflate the reported workload. Collection/DOM/memory gauges run every five seconds. The server
stops its event-loop monitor when telemetry stops and flushes on graceful shutdown. Failed diagnostics must not block app requests;
unload beacon delivery is best effort.

In the development page, `window.__moviefinderTelemetry` exposes `events`, `counts`, `summary()` and
an asynchronous `flush()`. Counts include upload retries/drops and collection-hook render counts.

## Verification and reproducible profiling

```sh
bun run test:observability   # actual Vite client → authenticated API → isolated PostgreSQL → file → CLI
bun run perf --keep          # synthetic catalog, real dev client, 4x CPU throttle; retains diagnostics
MOVIEFINDER_TELEMETRY_DIR=.local/perf-telemetry bun run telemetry bottlenecks
bun run perf --throttle 1
bun run perf --seed 2000 --lists 20
bun run perf --profile       # CPU self time per function
```

The observability browser suite checks desktop/mobile navigation, commands, query-value redaction,
immediate cold destination paint with API responses blocked, visible-data timing, cached artwork
starting before a held detail response, trace correlation through SQL and a delayed fixture provider, bounded uploads, preload completion/cancellation, recovery after a
failed upload, persisted diagnostics and CLI output. It creates temporary embedded PostgreSQL and
removes its database/recordings afterwards; it never uses `DATABASE_URL` or your development data.
Normal `bun run test:e2e` exercises the production build without browser telemetry.

The performance harness creates another isolated embedded database and synthetic catalog, then
registers, scrolls, tags, opens cold/prepared people and series, fills lists and visits each screen.
It makes no provider network requests. Run it without concurrent browser suites or source edits,
since Vite reloads invalidate timings. The harness reports click-to-destination paint opportunity
separately from click-to-filmography. Compare background preparation, request waits, SQL/provider
work, image waits, long tasks and React commits. Synthetic timings help reproduce problems but do
not establish a live-provider latency guarantee.

`bun run perf --drawer --profile` focuses on Add to list: it opens the drawer with an empty
account and with saved lists, types into the create-list form, checks rendering opportunities,
and closes/reopens it three times in each state. A native browser dialog fails the run because
it blocks the page. The printed cycle duration includes simulated typing and browser automation;
the separately reported frame timing measures the next rendering opportunity while editing.

## Adding instrumentation

Browser: `track`, `span` and `measure` from `src/client/telemetry.ts`. Use `contextFor`/`bindContext`
on operation-owned signals or response objects across asynchronous boundaries. Never use a mutable
global request context to label concurrent operations. Server: `record`, `timed`, `inTrace` and
`background` from `src/server/telemetry.ts`. New fields/static labels must be added intentionally to
the shared privacy allowlist and covered by appropriate tests.
