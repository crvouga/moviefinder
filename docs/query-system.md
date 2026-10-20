# Query system

`defineQuery` separates parameter validation, cache reading, background scheduling, and normalization. Execution reads PostgreSQL immediately and schedules durable work; it does not await an upstream HTTP call. Request cancellation prevents publishing an abandoned request response. Shared durable hydration is not canceled merely because one viewer navigates away.

Discovery parameters compose media type, included/excluded genres, dates/years, runtime, language, country, rating/votes/popularity, cast/crew, keywords, providers/region, viewing status, sentiment, list membership, query text, and sort order. Zod validates HTTP inputs. Parameter serialization sorts object keys. Cursors bind their page to the filter identity; a cursor from a different feed is rejected.

Provider-supported constraints are translated to TMDB discovery parameters. Viewing status, sentiment, membership, current-session exclusions, and popularity bounds are applied against available local state. The protocol reports unsupported metadata combinations, including TMDB's lack of TV cast/crew discovery constraints. No source-coverage claim is made from a partial local fallback.

The first response includes entities, ordered primary IDs, a stable query ID, and coverage. A missing page can still contain clearly partial cached matches. Once upstream ingestion commits, normalized entity deltas arrive over SSE. The completion signal causes an active query to read authoritative coverage and IDs again. Query metadata is itself a TanStack DB entity.

Pagination follows provider page limits and continues even when a locally filtered page is empty. IDs are deduplicated across loaded pages. For combined movie/TV sorts, a buffered merge preserves global source ordering across output pages, carrying the unread lane buffers in durable coverage state. Random and personalized ranking use a bounded provider candidate window; random discovery retains its URL seed, and personalization scores genre preferences from actual likes/dislikes. Saved feed parameters are persisted per user; useful active filters are reflected in the URL.

Search immediately renders matching canonical cached entities, then supplements them through the same durable query/ingestion system. Movie, TV, and person results have navigable identities. User/list search uses public normalized projections.

Query counters, latency, cache hits/misses, provider requests/rate limits, and failed jobs are exposed through authenticated metrics. Source responses and errors never expose provider credentials.

## Anticipatory navigation

Authenticated navigation warms screen code, canonical collection data and title
artwork only for a link the person is aiming at: pointer hover (after a short
pause), keyboard focus and primary press-down. Nothing is predicted from what
merely happens to be visible. Discovery additionally warms the current and next
title with **one** batched read (`GET /api/titles?ids=`, at most eight) and
artwork for the two after them, but only once the feed has rested for 400 ms, so
swiping quickly through slides starts no requests. It requests the next result
page twelve slides before the end. Predicted requests share a three-request
budget. Actual navigation promotes queued work immediately and joins in-flight
reads. Route loaders prepare the module and first cache response before
committing the destination, using the signed-in user remembered from the session
hook rather than asking the server on every navigation.

**Speculation is cheap and never takes the provider's turn.** A hover read
(`/api/title/:id?warm=1`) reports what the server already has and starts no
upstream work, so skimming across a grid cannot queue provider calls ahead of
the title that is opened. Batched warming queues missing titles one second out;
opening a title promotes the same durable job to now. The provider lane is
sequential and rate limited, so order matters more than count. A real request
for a cold title waits for its own hydration (up to 2.5 s, signalled in-process
when the job finishes, with the worker woken immediately instead of at the next
poll) and answers with the complete graph in one round trip; if the provider is
slow, events finish the job as before. A real request never accepts a hover
answer that did not hydrate the title.

**Cached reads are dropped precisely.** A completed read is trusted for 60 s
(5 s while coverage is incomplete) and is dropped only when something says it
changed: an SSE event for its subscription (`entity:<id>` drops that title,
`discover:` drops feeds, anything else drops lists and feeds) or a command (which
drops feeds and lists; entities arrive merged in its response). Speculative
answers are keyed the same way and survive until such an event.

Request metadata retains query IDs only; all entities remain in TanStack DB.
Speculation performs one read and never polls: server hydration is durable and
shared, and its progress arrives over SSE. Leaving an intent, changing routes,
hiding the tab or signing out releases that interest and aborts reads with no
remaining consumers.

SSE events are applied in bursts. Events received within 40 ms become one
collection commit (all kinds written in the same tick, so React renders once),
and the re-read of a subscribed query is coalesced to one trailing request per
300 ms. See [observability](observability.md) for measuring this.
Cold provider misses and upstream outages can still produce progressive content.
