# Query system

`defineQuery` separates parameter validation, cache reading, background scheduling, and normalization. Cache execution reads PostgreSQL immediately and schedules durable work. HTTP reads can wait for bounded hydration or explicitly requested readiness; route changes never await those reads. Request cancellation prevents publishing an abandoned request response. Shared durable hydration is not canceled merely because one viewer navigates away.

Discovery parameters compose media type, included/excluded genres, dates/years, runtime, language, country, rating/votes/popularity, cast/crew, keywords, providers/region, viewing status, sentiment, list membership, query text, and sort order. Zod validates HTTP inputs. Parameter serialization sorts object keys. Cursors bind their page to the filter identity; a cursor from a different feed is rejected.

Provider-supported constraints are translated to TMDB discovery parameters. Viewing status, sentiment, membership, current-session exclusions, and popularity bounds are applied against available local state. The protocol reports unsupported metadata combinations, including TMDB's lack of TV cast/crew discovery constraints. No source-coverage claim is made from a partial local fallback.

The first response includes entities, ordered primary IDs, a stable query ID, and coverage. A missing page can still contain clearly partial cached matches. Once upstream ingestion commits, normalized entity deltas arrive over SSE. The completion signal causes an active query to read authoritative coverage and IDs again. Query metadata is itself a TanStack DB entity.

Pagination follows provider page limits and continues even when a locally filtered page is empty. IDs are deduplicated across loaded pages. For combined movie/TV sorts, a buffered merge preserves global source ordering across output pages, carrying the unread lane buffers in durable coverage state. Random and personalized ranking use a bounded provider candidate window; random discovery retains its URL seed, and personalization scores genre preferences from actual likes/dislikes. Saved feed parameters are persisted per user; useful active filters are reflected in the URL.

Search immediately renders matching canonical cached entities, then supplements them through the same durable query/ingestion system. Movie, TV, and person results have navigable identities. User/list search uses public normalized projections.

Query counters, latency, cache hits/misses, provider requests/rate limits, and failed jobs are exposed through authenticated metrics. Source responses and errors never expose provider credentials.

## Anticipatory navigation

Navigation prioritizes switching screens immediately. All page components and the navigation shell
are bundled up front; routes have no asynchronous data or artwork loaders. Clicks, back/forward,
and filter/search URL changes commit independently of API, provider, or image readiness. The
destination renders cached canonical data immediately, or its structural placeholder when uncached.
Missing data and artwork arrive asynchronously through page effects and SSE. Failed cold detail
reads offer a retry on the destination. Detail pages first commit a lightweight cached heading and
artwork, then schedule the larger live graph after the first rendering opportunity in an
interruptible React transition. Partial cached matches never imply complete provider coverage.

Prediction starts after the screen/scroll has settled for 500 ms. It prepares primary navigation
once per session and at most two visible content destinations. Discovery separately prepares its
current and next title after resting for 450 ms, and requests the next result page twelve slides
before the end. All speculative data reads share a three-request budget. Predictions pause while a
navigation is pending; hidden tabs, Save-Data and 2G connections suppress automatic prediction.
Keyboard focus and a 350 ms hover prepare the intended destination; primary press-down starts a
foreground read immediately. Moving across a grid quickly starts no intent requests. Destination
data effects join in-flight work and bypass the speculative request budget. Abandoned interests cancel browser reads
when no other consumer needs them; durable shared hydration continues on the server.

`GET /api/title/:id?warm=1` remains a cache-only hint. A high-confidence prediction adds `ready=1`,
which schedules missing detail hydration 200 ms behind foreground work and waits for the complete
graph. Foreground ready reads schedule immediately. Delayed jobs wake the worker when due instead of
waiting for its next poll. Discovery's `ready=1` waits for its existing durable query job and reads
back authoritative page coverage. Readiness waits are bounded to ten seconds per server request and
use in-process completion signals, without browser polling or holding a database connection. A failed
or timed-out readiness request never claims complete provider coverage. These optional background
preparations never gate a route transition.

The same image resolver and responsive slots serve prediction and rendering. Background prediction
prepares critical artwork for reuse; image requests are shared and foreground consumers raise their priority.
Failed artwork or a three-second artwork timeout uses a static fallback, retained for 30 seconds to
avoid repeatedly requesting failing artwork. Successful decoded artwork is retained for 60 seconds
in a bounded metadata cache. Offscreen artwork remains lazy.

Request metadata retains query IDs only; all entities remain in TanStack DB. Complete reads are
trusted for 60 seconds (five seconds for incomplete coverage), and events/commands invalidate affected
keys. Invalidation during an in-flight read also prevents its eventual response from becoming fresh
again. Social reads use the same 60-second window. Live queries have explicit identities, and detail
views subscribe only to their own graph so speculative filmographies do not rerender the current
screen for unrelated entities.

SSE events received within 40 ms become one collection commit. Re-reading an active subscription is
coalesced to one trailing request per 300 ms. See [observability](observability.md) for measurements.
Cold network/provider misses still take time; preloading reduces the chance of encountering one and
navigation never waits for them. Visible data may fill in progressively; rendering still takes CPU
time on the device.

## Visible data and cached neighbour graphs

A title response also reads the server's cached rows for its first eight credited people and eight
related titles in one bounded SQL query. All available summaries are upgraded; at most two cached neighbours
can include their first-screen graphs, preferring visible people and then related titles. A person preview carries at
most 24 filmography titles. Expansion is one level only and starts no extra provider work. The
primary title keeps its full graph. Neighbour metadata uses `coverage.projection: "viewport"` and
`data.graphScope: "viewport"`; it never satisfies a complete-detail read. Opening that neighbour
can render its cached first screen while its full read continues independently.

Image preparation starts from already-cached URLs alongside HTTP, then directly from response
entities before their collection commit. The shared graph selector warms lead artwork, visible
credits/related titles, seasons and episode stills with at most 24 image interests per graph bundle. Secondary previews prepare only their lead artwork;
their own neighbouring images wait for direct interest.
The existing responsive resolver, cancellation, priority and bounded decoded-image cache still apply.

Detail HTTP reads start on the first destination commit, before the deferred full graph mounts.
Keyed live queries use synchronous reads of the same canonical collections while establishing their
subscriptions, avoiding empty cast/genre/card frames when the data is already present. Source
`graphVersion` metadata distinguishes loaded relations from a newer summary announcement. Identical
positive-version graphs and query metadata do not trigger duplicate upserts; viewport projections
cannot replace complete relations at the same version. A new summary still permits the subsequent
full graph to apply. SSE refresh skips a graph whose announced version has already been loaded.

The worker persists priority in job parameters: active reads precede intent preparation and
background warming. It claims one job at a time and checks for more due work immediately after
completion, rather than reserving a speculative batch or sleeping 800 ms between batches. Empty
polls back off but also consider the next pending job deadline, so later delayed interests are not
missed after the earliest wake fires. Provider pacing, durable retry deadlines and rate-limit
checkpoints remain in effect.
