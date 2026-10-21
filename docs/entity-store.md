# Entity store

`source_entity` is a selective replica, not a complete copy of TMDB. Canonical identities distinguish provider/type/ID. Seasons and episodes retain their series ancestry, e.g. `tmdb:tv:1399:season:1:episode:1`.

Raw JSONB remains separate from normalized projections. Each source record tracks identity, source schema version, summary/detail projection, checksum, fetch time, refresh deadline, last success/failure, error, and monotonic revision. Summary ingestion merges with an existing detail document rather than deleting credits and ancillary metadata. Failed validation rolls back the ingestion. Refresh failure preserves the previous good payload.

Normalizers emit movie, series, season, episode, person, credit, and genre entities with canonical references. They tolerate missing fields and preserve navigable relationships. Unknown data is never presented as invented plot, cast, or availability. Person summaries embedded in credits have revision zero, so they cannot replace an independently hydrated person.

Source indexes cover canonical identity, type/popularity, type/rating, release date, refresh deadlines, genres, and full-text title search. Query results use explicit source-query coverage records rather than inferring completeness from matching entity counts.

## Synchronization

A PostgreSQL job primary key deduplicates identical requests. Workers claim one job at a time using `FOR UPDATE SKIP LOCKED` and 120-second leases. Work runs through one bounded upstream request lane. Expired leases make interrupted jobs reclaimable. Retry state and next-run times survive process replacement. Repeated readers do not reset an existing retry delay.

The upstream adapter uses a fixed TMDB origin, server-only authorization, request timeouts, request pacing, and Retry-After parsing. Durable retries use bounded exponential backoff and jitter. Permanent HTTP failures and exhausted jobs are visible in metrics rather than silently discarded. Provider Retry-After deadlines also live in sync_checkpoint, so new jobs and replacement workers respect an existing cooldown.

Freshness adapts to the source: six hours for summaries, recent releases, and highly popular titles; one day for ordinary title details; seven days for people and older titles. Detail hydration has its own timestamp, and a summary cannot extend an existing detail freshness deadline. A bounded warming pass revisits recent stale records behind active reads. Due work drains without an extra poll delay between jobs; retry deadlines and provider pacing still apply. Cold or partial records are scheduled on demand. Cache reads are immediate; HTTP detail requests can wait for bounded hydration while client navigation remains independent.

The query cache records requested source page, canonical parameter identity, ordered IDs, retrieval time, expiry, completeness, continuation, and failure. Missing, partial, complete, stale, and failed coverage are explicit states. Upstream ingestion emits entity events and a query-completion signal after the authoritative coverage transaction commits.

Fixtures live exclusively in tests. `scripts/smoke.ts` is an optional explicit live-provider verification and never writes a database.
