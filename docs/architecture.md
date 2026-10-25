# Architecture

The production boundary is one Bun process, one public HTTP port, and one application origin. Hono owns `/api/*`; Better Auth owns `/api/auth/*`; the remaining registered application routes serve the compiled React SPA after a persisted-session check. Static hashed assets are immutable. Unknown API routes return JSON 404s rather than the SPA.

Development uses the same API with Vite+'s relative-origin proxy. `scripts/dev.ts` opens loopback-only PostgreSQL through `embedded-postgres`, applies committed Atlas migrations to that local database, then supervises the frontend and backend. It overrides any injected shared DATABASE_URL for both children. The explicit Stop hook signals the dev supervisor, which terminates both server process groups and its owned PostgreSQL process, preserving data under ignored `.local/`. Vite excludes that directory from watching and denies serving it, alongside its existing secret-file restrictions.

`scripts/local-database.ts` owns initialization, local credentials, dynamic loopback ports, database/schema creation, and cluster identity checks. Existing local commands attach to the same verified data directory and do not stop another launcher's server. A later start reopens the same data. Shared deployments still receive their explicit DATABASE_URL and require infrastructure allocation; local development does not depend on that allocation.

## Server boundaries

- `db/schema.ts`: Drizzle mapping of the allocated PostgreSQL schema, including Better Auth tables. SQL migration/schema files are authoritative.
- `auth.ts`: Better Auth's Drizzle adapter and persisted sessions, with credential registration/login/recovery endpoints disabled. Google through the shared relay is the sole sign-in method. `auth-relay.ts` supplies the shared relay's public OIDC code/S256 PKCE provider using Better Auth's authorization helpers and JOSE signature/claim validation, with exact issuer/client/callback binding, database-consumed state and independent per-flow browser cookies. No custom password storage. See [relay setup](auth-relay.md).
- `entity-store`: canonical source records, checksums, provenance/freshness, deterministic projection normalizers.
- `entity-store-sync`: upstream HTTP, discovery/search/detail ingestion, durable leases and retry schedules.
- `queries`: Zod parameter validation, identities/cursors, immediate cache reads, normalization, and scheduling of missing/stale coverage.
- `commands`: authenticated authorization, individual field/item changes, database constraints, operation receipts, and event publication in one transaction.
- `events.ts` and the events route: durable ordered replay and authenticated streaming.
- `state.ts`: repeatable-read bootstrap/recovery snapshots paired with an event watermark. Public projections exclude email, sessions, passwords, and tokens.

## Browser boundaries

TanStack Router owns deep links and navigation. Authentication restoration gates application routes. The intended route is retained through login; only safe same-origin return targets are accepted.

`client/state.ts` defines a canonical TanStack DB query collection per entity kind. Query Collections fetch a shared bootstrap snapshot through Hono RPC. Server responses and SSE events merge into these collections. Components derive views using live queries rather than storing copies of entities in local state. Local state holds search input, dialogs, view identities, and gesture positions.

Commands create TanStack DB optimistic transactions, enter a per-resource request lane, and merge the authoritative response before optimistic overlays settle. A failed command rolls back its overlay and displays a non-blocking message. A transport retry reuses the operation ID.

List-shaped responses (feeds, the bootstrap snapshot, saved lists and SSE events) carry titles as summaries: scalar fields only, marked `data.summary`. Relations, credits and other collections arrive with the detail view, whose graph is bounded (100 cast, 40 crew, 30 guests, 300 filmography entries); the source JSON keeps everything. A summary never replaces relations the client already holds, and a screen showing a title re-reads it when its subscription changes. Without this, one long-running series put 16,000 entities (4 MB) into every feed response and froze the interface for seconds.

Discovery mounts only neighboring virtual slides. Poster dimensions are reserved and at most two upcoming posters are explicitly prefetched after the feed rests. Artwork resolution is chosen by the image module below. Feed positions are transient session UI state. All route components ship in the initial bundle. Screens commit a lightweight destination before mounting live queries and larger content after a rendering opportunity. Only the outlet and active navigation subscribe to pathname changes; navigation does not rerun the root's shared collection hooks and indexes.

## Images

`src/client/images.ts` is the only code that builds TMDB image URLs. A screen hands the `<Image>` component (`components/image.tsx`) every image an entity has (`entityImages`) and the named slot it will fill (`feed`, `card`, `hero`, `thumb`, `still`, `backdrop`, `avatar`). The slot declares the acceptable shapes in preference order, the CSS `sizes` it is laid out at and a maximum useful pixel width. The module picks the source whose shape fits (a feed slide falls back to a backdrop when a title has no poster), emits a `srcset` from TMDB's per-role size ladder up to that cap, and lets the browser choose by viewport and pixel density. `original` is never requested. Absolute HTTPS URLs such as account photos pass through untouched. Preloading calls the same resolver for the detail page's slots, so warmed requests are the ones the page makes. Add a slot rather than a one-off size when a new layout needs different artwork.

## Operational scope

Pools contain at most five connections with acquisition and statement timeouts. Logs carry request IDs and structured categories; they do not include URLs with query strings, upstream bodies, credentials, or database errors containing connection details. Better Auth's `onAPIError.throw` option passes unexpected errors to Hono for sanitization, preventing the underlying router from printing SQL parameters; expected authentication API errors retain their normal HTTP status. See the [Better Auth option reference](https://better-auth.com/docs/reference/options#onapierror).

Liveness never queries dependencies. Readiness checks the application's required tables/columns separately. `db/readiness.ts` derives that inventory from the Drizzle mappings, traverses wrapped driver error codes, and produces safe shared-database diagnostics. Missing schema or permissions pauses the catalog worker until restart; known transient connection failures retry with capped exponential backoff and at most one failure log per minute. SIGTERM closes streams, cancels synchronization, drains the HTTP server, and closes the pool.

The initial deployment serializes committing writers to make conflict resolution and replay unambiguous. PostgreSQL event polling supports visibility across processes without an in-memory-only fan-out assumption. High-volume deployments should measure the commit lock and polling load before increasing replicas.
