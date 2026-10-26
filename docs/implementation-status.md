# Implementation and verification status

Updated on 2026-10-25 (America/Phoenix). This is an implementation handoff, not a claim of completed production deployment.

## Delivered application

The repository now contains a functioning TypeScript/Bun application rather than only a specification. React 19, Vite+, TanStack Router, Mantine, Swiper, TanStack DB Query Collections, Hono RPC, Better Auth, Drizzle, PostgreSQL, Atlas, Zod, and Playwright are integrated.

Implemented vertical features include protected registration/login/logout/session restoration and deep-link return; recovery-token issuance/consumption and session revocation; public profile editing and avatars; movie/TV discovery and composable/saved feeds; cursor pagination and global merging of sorted movie/TV source streams; independent optimistic viewing/opinion tags; public lists with stable item identities, editing, reorder handles/arrows, invitations/acceptance/decline, owner/editor permissions, copies and saves; user follows, activity, global catalog/social search, and scoped/paginated list/profile reads.

Movie, TV, season, episode, person, credit, and genre projections retain navigable canonical relationships. Details expose source metadata, cast/crew, recommendations, trailers, external links, TV seasons/episodes, person filmographies by department, and sourced streaming availability. Missing metadata remains absent or explicitly unavailable.

The selective source replica retains JSONB, revisions/checksums, projection-specific fetch metadata, adaptive deadlines, source coverage, durable jobs/leases, and persisted upstream cooldown checkpoints. Query definitions separate cache reads, scheduling, and normalization. SSE includes durable ordered replay, snapshots, session checks, heartbeats, duplicate/stale-revision handling, and shutdown cleanup. Commands commit their operation receipt and event with authoritative state. A per-user browser outbox protects queued command intent across reload without storing authentication secrets or duplicate server entities.

## Files and boundaries

- `src/server/db`, `atlas/schema.sql`, `atlas/migrations`, `atlas.hcl`: isolated schema mapping and Atlas authority.
- `src/server/entity-store`, `entity-store-sync`, `queries`: raw replica, normalization, provider ingestion/jobs/coverage, and declarative query definitions.
- `src/server/auth.ts`, `app.ts`, `commands.ts`, `events.ts`, `social.ts`, `state.ts`, `static.ts`, `index.ts`: persisted authentication, typed APIs, authorization/concurrency, streaming/replay, public projections, and single-process serving.
- `src/client`: canonical collections, query/subscription merging, optimistic commands/outbox, routing, Mantine UI, and accessible drawers/navigation.
- `src/shared`: validated commands/feeds/events, identities, filter semantics, genre taxonomies, and URL serialization.
- `scripts`, `tests`, `.github/workflows`, `Dockerfile`: development supervision, isolated PostgreSQL tests, Atlas verification, live catalog/container smoke, and centralized publishing configuration.
- `README.md`, `AGENTS.md`, and `docs/*`: setup, actual architecture/contracts, verification, and prepared infrastructure handoff.

The UI technology requirements in SPEC.md now reflect the requested React/Mantine-only architecture. No pre-existing application code, legacy deployment, shared database, shared policy, or infrastructure allocation was overwritten. Development database diagnostics read application catalog metadata only; shared DDL and writes remain unperformed.

## Verification evidence

| Command / check                                                     | Actual result                                                                                                                                       |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run check`                                                     | Passed: Oxfmt, Oxlint, native type checking with no warnings/errors; 24 unit/property tests                                                         |
| `bun run build`                                                     | Passed: code-split production assets; no oversized-chunk warning                                                                                    |
| `bun run test:integration`                                          | Passed: 38 tests against fresh disposable PostgreSQL with real Atlas migrations and Better Auth                                                     |
| `bun run test:e2e`                                                  | Passed: 20 tests across mobile and desktop Chromium with real Bun/Hono/PostgreSQL and deterministic upstream fixtures                               |
| `bun run db:validate`                                               | Passed: all committed migration hashes valid                                                                                                        |
| `bun run db:verify`                                                 | Passed: fresh Atlas replay and desired-schema comparison report no schema changes                                                                   |
| `vault run -- bun scripts/smoke.ts`                                 | Passed against live TMDB: movie, TV, season, episode, and person source documents validate and normalize; no database writes                        |
| `docker build --platform linux/amd64 -t moviefinder:verification .` | Passed: image built, 89,073,376 bytes (84.9 MiB)                                                                                                    |
| Native ARM64 image build and container smoke                        | Passed: `/health` 200 with PostgreSQL unavailable, `/auth` 200, protected API 401, protected deep link 302; final image 90,392,880 bytes (86.2 MiB) |
| Local emulated x64 container execution                              | Failed inside Bun 1.4.2 before application startup, with no AVX support reported by the emulator; not counted as a successful runtime check         |
| Native x64 CI / public live deployment                              | Not executed; required before production completion                                                                                                 |

Browser coverage includes registration and reload, touch/wheel poster navigation with bounded slide nodes and position restoration, correct return to a protected deep link, independent tags across navigation, list creation/add/reorder/reload, TV/season/episode navigation, search/profile persistence, two-user concurrent additions and reconnect recovery, combined filters/URL serialization, optimistic rollback after 403, recovery after a temporary initial snapshot failure, saved feeds, list copies, invitation acceptance, no-op command persistence, and ordered recovery of dependent offline commands. Unit/integration coverage includes provider cooldown across workers, expired lease recovery, partial movie coverage when TV fails, dense ordering properties, event replay/reset, and unchanged-ingestion idempotency.

The main browser entry is approximately 296 KB before gzip (95 KB gzipped), with shared dependencies and the authenticated data layer split into separate chunks. This is a bundle measurement, not a claim of performance testing on a physical handset. Poster dimensions, bounded adjacent prefetch, and virtual slide rendering are implemented; physical-device performance validation remains unperformed.

## Migration status

Three versioned migration files are included in the implementation commit:

1. `202610160001_initial.sql`: application/auth/catalog/social/collaboration/event tables and indexes; assumes an already allocated schema.
2. `20261016051851_projection_freshness.sql`: additive detail-fetch timestamp.
3. `20261016053809_durable_provider_cooldown.sql`: additive synchronization checkpoint table.

The latter migrations were generated by Atlas. All three applied successfully to isolated test PostgreSQL and the persistent local embedded database; the desired SQL model matches the replayed schema. **No shared development or production migration was applied.** Atlas revision metadata is configured inside the application's namespace. The guarded apply command is not allocation authorization.

## External blockers and unverified acceptance criteria

- No approved PostgreSQL/schema allocation or fleet service for `crvouga/moviefinder` is recorded in the checked shared inventory. Existing MovieFinder services belong to different repositories and remain intact. The central OpenTofu process must approve this repository's role and allocate its resources before shared DDL/writes or rollout.
- `BETTER_AUTH_SECRET` exists in development but its required inventory/production registration must be reconciled. Runtime secrets and the app-specific public origin must be declared through the shared workflow.
- Password recovery delivery requires `RESEND_API_KEY` and verified `EMAIL_FROM`; development lacks the mail key. The real token/reset/revocation logic is tested with captured delivery, not a live email. Optional Google login remains disabled without app-specific credentials/callback configuration.
- The implementation and migration history are committed on the local feature branch. Upstream source/image integration and native x64 CI remain outstanding. Publishing is configured exclusively through the documented reusable GHCR workflow; no manual image push, Railway setup, or shared resource change was performed. No public health endpoint for this new implementation has been verified.
- The local x64 emulator crashes in Bun itself. Native ARM execution passes; native x64 runtime validation on the configured runner is still required. No runtime substitution or check suppression was used.

The complete request body is [hosting-request.md](hosting-request.md); setup and rollout instructions are [infrastructure.md](infrastructure.md). The request has not been submitted because the guide's upstream source/published-image prerequisites are still pending. No approval, attestation, production deployment, or external verification is implied by local test success.

## Product/source limits

TMDB has distinct film and TV genre categories and lacks some TV cast/crew discovery constraints. The app reports affected combinations, uses cached credits where available, and avoids claiming unavailable metadata is complete. Random and personalized feeds rank bounded provider candidates; they do not claim a uniform sample or exhaustive ordering of the full TMDB catalog. Personalization uses actual genre preferences rather than invented recommendations.

The initial architecture deliberately serializes committing writes and polls PostgreSQL events. It retains durable event/operation history without automatic destructive pruning. Measure workload before scaling replicas or adding a reviewed retention strategy. Shared deployment, mail delivery, OAuth, physical-handset testing, and native x64 runtime checks must remain unchecked until real evidence exists.

## Local missing-table follow-up (2026-10-16)

The reported `relation "moviefinder.user" does not exist` error was reproduced against disposable PostgreSQL. A read-only check of the selected Vault development database confirms that required application tables/columns are absent. The current inventory was re-fetched and still records no schema allocation for this repository. No shared migration was applied.

Development now checks all required tables/columns before starting either server and exits with migration/allocation instructions when they are missing. Database readiness uses the same check; public liveness stays independent. Missing-schema/permissions errors pause synchronization until restart; transient connection failures back off with bounded logs. Unexpected Better Auth errors go through Hono's sanitized 503 response instead of printing SQL parameters. Regression tests cover missing authentication tables, additive columns, expected invalid-credential responses, read-only metadata checks, worker pause, and transient recovery.

The super.engineering Run menu includes **Database check** (read only) and **Migrate database** (the existing allocation-guarded Atlas command). This historical local blocker is superseded by the embedded PostgreSQL follow-up below; shared deployment still requires allocation. A credential being available in Vault is not evidence that the application schema has been provisioned.

## Embedded local development follow-up (2026-10-16)

The user explicitly requested `embedded-postgres` for local development. Local startup now initializes a persistent per-checkout PostgreSQL cluster, applies Atlas migrations, and starts the app using that locally generated connection. Vault still supplies catalog/auth configuration; its shared DATABASE_URL is overridden for the local children. `db:migrate`, `db:status`, `db:check`, and `db:drift` target embedded PostgreSQL. Explicit `:shared` variants preserve the Vault contract and allocation guard for shared environments. Local data and credentials are excluded from Git and Docker contexts. No shared database allocation is required to run MovieFinder locally.

The real embedded lifecycle regression passes: a fresh cluster receives all three Atlas migrations, registration persists across restart, attached commands do not stop an owning launcher, owned servers stop cleanly, and nonlocal migration targets are rejected. See `bun run test:local-database`. Existing shared infrastructure authorization/deployment requirements above are production limitations, not local startup blockers.

Local integration/browser suites and Atlas generation/verification now use isolated temporary embedded PostgreSQL by default; an explicit validated loopback TEST_DATABASE_URL remains supported, including PostgreSQL 17 CI service checks. The built-in MovieFinder Stop hook signals the owning supervisor and terminates its server process groups, avoiding orphaned wrapper children. Actual super.engineering startup, local table checks, Stop, data preservation, and restart have been verified. The app now serves locally without the previous shared allocation blocker.

Verified on the final embedded path: 24 unit/property tests, 38 database integration tests, 20 browser tests, the embedded lifecycle regression, production client build, Atlas migration validation, and local schema replay/comparison. Shared PostgreSQL is unchanged. The prior Docker image measurements/smoke evidence above predate this local-tooling change; no fresh container-image verification is claimed for this follow-up.

Local PostgreSQL data/credentials are ignored by Git and Docker, excluded from Vite file watching, and explicitly denied by Vite's file-serving rules. A real request to the local credential path returns 403. Local credentials and initdb temporary credentials are created with private permissions.

## CI simplification follow-up

Validation and publishing now share `.github/workflows/check.yml`. The three existing required job names and their coverage are preserved, with shared toolchain setup, explicit time limits, merge queue support, and cancellation of superseded PR runs. Publishing requires all three jobs to pass on main. Main push runs serialize through publishing; scheduled/manual checks use separate concurrency groups. Production migration and live catalog workflows remain manual.

Verified locally for this change: frozen dependency installation, `actionlint`, formatting/lint/type checking and 30 unit/property tests, production build, Atlas migration validation, 38 isolated embedded PostgreSQL integration tests, schema replay/comparison, the embedded lifecycle test, and 22 mobile/desktop browser tests. PostgreSQL 17 service coverage remains in CI; the local integration run used embedded PostgreSQL. Docker daemon discovery did not respond, so no new container build or runtime smoke is claimed. The updated workflow has not yet run on GitHub.

Publishing remains blocked by the platform-owned dispatch credential and failed foundation environment import documented in [infrastructure](infrastructure.md). No shared resources, credentials, or databases were modified to clear that failure.

## Navigation readiness and preloading follow-up (2026-10-20)

Route loaders now prepare screen modules, canonical data and decoded critical artwork before
presenting the destination. Discovery/search read committed route parameters, preventing a pending
URL from applying new filters to the previous page's data. Discovery changes its result identity
and saved position together. Router-aware lazy components prevent a module-loading fallback on the
first visit. Cold failures offer a retry instead of presenting incomplete provider coverage; a
previously complete provider page remains usable when its refresh fails.

Primary navigation, two visible content links and the current/next feed title are prepared in
advance under a shared three-request speculative budget. Hover waits 350 ms and feed warming waits
450 ms so rapid movement does not hydrate every card. Press-down uses foreground priority; actual
navigation joins existing work. Predictions pause during navigation and respect hidden tabs,
Save-Data and slow connections. Shared image preparation waits for decoding, promotes foreground
priority and provides static fallbacks for failed/stalled artwork. Collection covers use the same
item ordering as their view, including collaborator-owned lists. Season preparation includes the
first episode stills.

Request invalidation during a read prevents its eventual response from becoming fresh again.
Explicit live-query identities avoid rebuilding query identities on every render, and detail pages
subscribe only to their own graph. All entities still live in TanStack DB; preloading introduces no
second entity cache. Durable hydration still belongs to entity-store-sync and retains provider rate
limits and shared job ownership. No schema migrations or shared infrastructure changes were made.

Verification: `bun run check` passes formatting, lint, native TypeScript and 51 unit/property tests;
`bun run test:integration` passes 44 isolated embedded PostgreSQL tests. The browser suite passed
32 desktop/mobile cases, followed by focused runs covering search/discovery query isolation and
rapid skimming (36 distinct cases in total). Browser checks cover delayed data and decoded artwork,
back/forward navigation, first-frame filter handoff, speculative request bounds, cancellation,
Save-Data and preservation of text typed during a pending search. Production builds pass. The
performance harness now closes its browser/application on failures and captures a failure screenshot
when Chromium responds.

The completed local `bun run perf --keep` benchmark used synthetic provider data, 4x client CPU
throttling and blocked remote artwork. Cold person-navigation samples changed from
635/564/937/551/625 ms (median 625 ms) to 549/505/501/440/665 ms (median 505 ms). Prepared-link samples
were 241/198/329/283/222 ms (median 241 ms). The full browsing/list/profile run completed without
application errors. Compared with the earlier, more eager preload policy on the same extended
scenario, intent launches fell from 160 to 54 and feed warming from 32 to 5. These are local fixture
measurements; the prepared-navigation phase is additional work relative to the original benchmark,
so aggregate long-task totals are not a direct before/after comparison.

No live-provider, production or physical-handset latency claim is made. Cold network/provider misses
can still take time; the complete current screen remains visible while the next route prepares.

## Local end-to-end performance diagnostics

Local development now correlates navigation preparation with pooled work, API response headers,
body parsing, canonical collection commits, PostgreSQL queries and connection acquisition, durable
worker queue/execution/waiting, and provider calls. Critical artwork has separate download/decode
and consumer-wait events. Rendering, browser performance entries, SSE, memory and event-loop samples
remain available alongside these traces. Pooled reads and images have independent work contexts;
links follow producers without attributing another consumer's navigation to the current one.
Previously completed shared work is labeled explicitly. These timings overlap and cannot be added
into a critical path; the paint marker records a rendering opportunity, not pixel completeness.

`bun run telemetry watch --since 5m` supplies a live compact report while browsing. `bottlenecks`,
`traces --trace UUID`, `slow`, `tail` and JSON output support detailed investigation, including
request traces for commands. The reader handles out-of-order uploads, truncated lines and large
sessions. Request equality uses opaque per-page identifiers rather than filter names.

A shared allowlist removes private paths, search text, entity/user IDs, arbitrary error messages and
SQL literals before buffering or persistence. SQL records contain operation/table shapes. Browser
uploads are bounded below 48 KB and retry failures; buffers, file rotation and dropped-event counters
are bounded. Server timings exclude diagnostic uploads themselves and never clone response bodies.
Production refuses telemetry configuration and does not install browser instrumentation.

Validation: formatting, lint, native TypeScript and 61 unit/property tests pass, including concurrent
trace isolation, shared-producer direction, privacy and a 150,000-event report. The 44 isolated
PostgreSQL integration tests and 38 production browser cases pass. Two additional desktop/mobile
observability cases run the actual Vite client through authentication, cold navigation, commands,
SQL, workers and a delayed provider fixture into a telemetry file and CLI report. They also check
private browser counters/buffers, redaction, preload cancellation, bounded batches and retry recovery.

The full isolated performance run completed with 33,766 events, coverage of all instrumented layers,
zero sampled dropped events, no uncaught application errors and a final browser heap of 93 MB.
With synthetic providers and 4x CPU throttling, cold person samples were 542/369/448/477/392 ms
(median 448 ms), and prepared-link samples were 149/148/204/183/210 ms (median 183 ms). The slowest
recorded navigation's next rendering opportunity was about 1,481 ms; its title API took about
1,216 ms and its nested hydration wait about 1,195 ms. Those nested timings identify server-side
hydration waiting on that path; they are not additive or a claim about live-provider latency.

## Immediate navigation with progressive destination content

Navigation now prioritizes screen changes over complete data and artwork. This supersedes the
complete-destination boundary described above. All route components and the navigation shell load
before the app becomes interactive. Routes have no asynchronous data/readiness/image loaders;
clicks, browser back/forward and filter/search URL changes commit independently of those requests.
Pages use canonical cached data immediately and fetch missing projections in background effects.
A cold detail destination has a static structural placeholder and a retry after a failed read.
Detail destinations commit a lightweight cached heading/artwork before mounting their larger live
graph, with enrichment scheduled after the first frame through an interruptible React transition.
Background prediction, deduplication, bounded request concurrency and source coverage remain intact.

Navigation telemetry now measures destination opening separately from background enrichment.
Page-owned request signals retain the navigation context after route resolution, including the
API, PostgreSQL, worker, provider, parse and merge stages. Native image completion is recorded as
`image.display`. The performance harness reports click-to-destination paint opportunity separately
from click-to-filmography; neither marker claims complete pixels or live-provider latency.

Validation: native TypeScript, lint, formatting and all 61 unit/property tests pass. All 40 production
browser cases and both desktop/mobile observability cases pass. Regression tests hold API responses
and artwork indefinitely while checking destination rendering, cached summaries, browser back/forward,
all primary routes without further screen scripts, and immediate filter changes. Observability also
asserts that a cold destination records a paint opportunity before its API response is released.

The completed isolated synthetic benchmark at 4x CPU throttling measured cold detail destination
paint opportunities at 37/40/31/30/29 ms (median 31 ms), and prepared destinations at
31/33/33/32/34 ms (median 33 ms). Filmography appeared later: cold samples were
271/258/214/186/205 ms and prepared samples 132/248/209/201/232 ms. The broader browsing, list,
activity and profile run completed with 28,598 events, all instrumented-layer coverage, zero sampled
telemetry drops, no uncaught application errors and a final browser heap of 87 MB. Its slowest
recorded navigation paint opportunity was about 80 ms. These synthetic rendering-opportunity
measurements do not establish pixel completeness, physical-device or live-provider latency guarantees.

## Reducing partial destination data

Navigation remains independent of data readiness. Title responses now include cached first-screen
neighbour graphs: summaries for up to eight visible people and eight related titles, plus at most
two cached detail previews, preferring visible people. Person previews contain at most 24 filmography
titles. One bounded SQL read supplies these cached neighbours without recursive expansion or extra
provider hydration. `coverage.projection` and `data.graphScope` explicitly distinguish a viewport
preview from a full graph. Cache-only reads of summary source rows remain summaries and cannot
claim a detail graph is loaded. Raw provider JSON remains intact.

Known artwork starts alongside HTTP, and response artwork starts before collection commits. The
image budget is 24 interests per bundle; secondary previews warm lead artwork only. Detail reads
start with the destination's first commit, before the deferred large view mounts. Live-query startup
uses canonical collection rows when available to avoid empty initial cast/genre/card results.
Summary normalization no longer builds and discards an entire relation graph. Source graph-version
metadata permits same-version preview-to-full upgrades, preserves newer details, and skips duplicate
full/preview writes. Query metadata and SSE pool invalidation also avoid repeating already loaded
source versions. Failed partial detail reads retain visible content and offer retry.

Worker priorities distinguish foreground reads, intent preparation and background warming in durable
job parameters. The worker claims one job at a time, drains due work without idle poll gaps, and
checks the next pending deadline so later delayed interests are not missed after the first wake.
Retry deadlines and provider pacing are preserved. An experimental client index was removed after
it failed to improve this workload; it is not part of the final change.

`content.ready` and trace `contentMs` measure first-screen data independently from route paint and
image completion. Cached graph SQL and entity counts are recorded. Telemetry now drains successful
bursts in batches of at most 200 events below 48 KB, yielding 50 ms between batches with one upload
in flight. Failed uploads keep the normal retry cadence. Browser tests verify that an 800-event
burst recovers automatically after a failed upload without manual flushing.

Validation: native TypeScript, lint, formatting and 67 unit/property tests pass; 49 isolated database
integration tests, 40 production browser cases and both desktop/mobile observability cases pass.
Regression tests hold a person's direct detail response and artwork while its first-screen graph
renders from the parent movie response, verify back/forward, and check that a viewport graph later
upgrades to full detail. Integration cases cover bounded graph inclusion, no recursive provider work,
source-version upgrades, foreground priority, delayed wake-ups, retry deadlines and honest summaries.

The final full isolated synthetic run at 4x CPU throttling completed with 35,302 events, all
instrumented-layer coverage, zero sampled telemetry drops, no uncaught application errors and a
final browser heap of 65 MB. The cached-neighbour scenario opened its destination at the next paint
opportunity in 54 ms and displayed filmography in 558 ms while direct person responses remained
blocked. Cold destination paint samples were 51/46/105/88/63 ms; prepared samples were
90/190/59/68/125 ms. The host was busy during this run: registration took 15.1 seconds versus 2.8
seconds in the earlier baseline. These timings are diagnostic, not a controlled speedup comparison
or a live-provider, complete-pixel, or device latency guarantee. The blocked-response regression is
the direct evidence that cached graphs reduce missing visible data independently of request latency.

The Add to list drawer now creates lists with an inline form instead of `window.prompt`, which
blocks page execution while open. Picker membership, title counts and duplicate checks use a
memoized view of the canonical collections prepared by the viewer provider, avoiding new live
queries and repeated full-item scans on opening. Large pickers reveal 48 lists at a time. The
shared list-item index also builds groups without repeatedly copying growing arrays.

Validation: the new regression first failed against the previous implementation because it opened
a native prompt. It now passes on mobile and desktop, covering typing, keyboard submission,
creation, saved membership, Escape, closing, reopening and interaction after dismissal on both
discovery and detail pages. Native TypeScript, lint, formatting and all 67 unit tests pass. The
focused development performance run completed six open/type/close cycles with and without saved
lists, no application errors, and 13–33 ms next-frame opportunities while editing at 4x CPU
throttling. Those frame measurements exclude opening latency and simulated typing duration.

Google sign-in now integrates with the shared auth relay as a public OIDC code/S256 PKCE
client. It uses the existing Better Auth tables, signed ID-token validation, exact issuer/client/
callback binding, per-tab cookies and atomic database state consumption. Provider identity is
`(issuer, subject)`; email matches never merge accounts automatically. Cookies are namespaced by
application origin, requiring one new sign-in for existing browser sessions. Local startup accepts
an explicit `MOVIEFINDER_WEB_PORT` to preserve registered callbacks. See [setup](auth-relay.md).

Validation on 2026-10-24: formatting, lint, native TypeScript and all 69 unit tests pass;
62 isolated PostgreSQL integration cases and all 46 mobile/desktop Chromium browser cases pass;
the production build passes. Relay fixtures use actual RS256 signing and verify rejected
signatures/claims, concurrent tabs/replay, expired state, client/instance separation and session
restoration after restart during provider outage. Browser Google-button/error cases stub the
provider-start response; they do not establish a browser flow through live Google.

The dev launcher also accepts returned public connection metadata from ignored
`.local/auth-relay.json`, retaining the registered port and injecting OIDC settings automatically.
Expired, malformed or nonlocal settings fail clearly. Formatting, lint, native TypeScript and
all 72 unit tests pass after this addition; prior integration/browser/build results above remain
the verification for the unchanged authentication flow.

Live setup on 2026-10-24: the human completed the nonproduction relay's required initial operator
claim. The operator session API confirmed authorization, and the authenticated same-origin
registration API created a dedicated MovieFinder localhost client for this checkout. Readback
confirmed the exact callback, immutable project/environment/instance and active registration.
Returned public settings are saved only under ignored `.local/`; ordinary `bun run dev` now enables
Google sign-in without extra environment variables and preserves the callback across restarts.
This development registration expires on 2026-10-31 and must be renewed through the relay API.
No agent credential, Google secret, setup credential or operator session was copied into MovieFinder.

The super.engineering browser (Safari 18.5 / AppleWebKit 605.1.15 user agent) completed live
Google-backed OIDC sign-in through the existing Google/relay session. MovieFinder confirmed a
verified local user session and HTTP 200 from the protected state API. The application session
survived both page reload and a full local server/database stop and restart. Signing out returned
HTTP 200 and restored HTTP 401 on the protected API. A subsequent Google-backed sign-in restored
the intended `/lists` destination and an authenticated session. No OAuth codes, tokens, cookies or
personal profile data were recorded as evidence. The application is left running locally.

A second separately registered localhost instance used a disposable embedded database and the
same browser. It initially had no application session despite the first instance being signed in,
then completed its own Google-backed sign-in and authenticated state request. Both sessions
remained valid independently. Revoking only the temporary registration preserved its established
local session under application policy; signing out there preserved the first instance's session.
The temporary client was revoked through the operator API, its readback confirmed revocation,
and its server, browser tab, database and local verification files were removed.

Shared control-plane resources, policies, secrets and schema definitions were not changed. Only
runtime relay application registration data was written via its authorized API. Production
MovieFinder registration/configuration/deployment, fresh Google browser-profile consent,
unrelated public domains, full browser compatibility and the relay's platform reliability gates
remain unverified. Local live sign-in does not establish production readiness.

The sign-in interface now offers Google only, following the browser annotation. Email/password
registration, email and username password login, verification, password changes and recovery are
disabled server-side, including old token-specific reset links. New accounts are created by
verified Google sign-in. The page has one accessible action using Google's unmodified pre-approved
light rectangular button asset, preserving its current colored logo, typography, padding and
aspect ratio; focus and error/retry states remain visible on mobile and desktop.

Authentication setup for application integration, database lifecycle, browser, observability and
synthetic performance runs now uses pinned Mockingbird OAuth with its Google profile. Tests drive
public S256 PKCE, the real callback and signed-token validation; browser flows complete the
emulator's account creation and consent UI. No password fallback or test authentication bypass
was added. Production/development still use the shared relay; the emulator is a development-only
dependency and local HTTP issuers require test mode. The separate adversarial relay fixture
continues to verify cryptographic rejection and replay handling.

Validation after the Google-only change: formatting, lint, native TypeScript and 72 unit tests;
70 isolated database integration tests; all 52 mobile/desktop Chromium browser cases; the embedded
database persistence/shutdown test; and both mobile/desktop observability cases pass. The browser
verification script also rebuilt the production bundle successfully. A fresh live relay sign-in
from the redesigned button produced a verified MovieFinder session and HTTP 200 from its protected
state API. Live credential and recovery endpoints returned HTTP 404. The app remains running at
its registered localhost port, with the browser returned to the redesigned authentication page.
Google branding is based on the published pre-approved asset; this does not claim Google's app
verification or the shared relay's broader production acceptance.

## React and Mantine UI overhaul — 2026-10-25

All existing screens now use Mantine 9.7.3 with one theme and provider setup:
authentication, discovery and all filters, catalog/social search, movie/TV/person/
season/episode details, lists and collaboration, activity/invitations, profiles,
route previews, errors and not-found states. Navigation uses a responsive AppShell;
labels and feedback use neutral app language. Existing routes, canonical entity
collections, optimistic commands, permissions, authentication and server APIs remain
in place. Tailwind, Radix primitive wrappers and their styling dependencies were
removed along with the 2,972-line stylesheet.

The remaining application CSS covers persistent browser scrollbar space, touch
dragging and the focus-revealed skip link. Swiper supplies virtual vertical gesture navigation,
with its viewport configured through Mantine Box; Lucide supplies icons. Google's
unmodified sign-in bitmap remains the provider-brand exception. These boundaries,
the route inventory and implementation conventions are in [UI conventions](ui.md).
AGENTS.md, SPEC.md and the architecture check now enforce the same UI direction.

Validation: formatting, type-aware lint, native TypeScript and all 75 unit tests
pass; all 71 isolated database integration cases pass; production compilation,
Atlas migration integrity and the embedded database lifecycle case pass. The full
68-case mobile/desktop production-browser suite passed. Six focused browser cases
then rechecked the final feed composition, virtual swiping, the complete automated
accessibility route matrix, and additional 320 px/768 px layouts. This includes
the two additional narrow/tablet cases (70 distinct production-browser cases in
total). Both development observability cases pass, including correlated API/SQL/
provider traces and privacy checks. Representative rendered screenshots were
reviewed at phone, tablet and desktop sizes. Automated WCAG A/AA scans have no
reported violations on the tested screens; this is not a complete accessibility
certification or verification of every browser/assistive-technology combination.

The build retains its eager application-chunk size warning (approximately 1.37 MB
minified, 414 KB gzip). Routes remain available before interaction; the existing
no-additional-screen-script and under-100 ms cold-navigation checks at 4x CPU
throttling still pass. Live Google, live catalog data and production deployment
were not reverified by this UI-only change. Verification uses isolated local
PostgreSQL and OAuth/catalog fixtures, with no shared infrastructure changes.

## Local startup and Google sign-in repair (2026-10-25)

Vite binds to localhost and prints a single local URL instead of enumerating the
machine's interface aliases. Development startup warns when this checkout lacks
Google registration settings and requires a fixed callback port for explicit
OIDC configuration. Regression coverage checks saved-port selection, mismatches,
explicit overrides and partial configuration.

This worktree lacked its ignored `.local/auth-relay.json`. Its own nonproduction
registration was created through the authorized relay console and read back with
the exact callback and 2026-10-31 expiry. The returned public settings were saved
only in that ignored file. After a managed restart, live Google sign-in and
session reload succeeded in the super.engineering WebKit browser at
`http://localhost:58553`; startup printed one URL. No shared infrastructure or
application schema was changed.

`bun run check` passed all 76 unit tests, lint, formatting and native type checks;
`bun run build` passed with the existing chunk-size warning; all 71 isolated
integration tests and all 70 mobile/desktop browser tests passed. The broad synthetic performance run timed out in a
prepared-person navigation wait and is not a completed performance result.

## Layout stability — 2026-10-25

The native page scrollbar and gutter are permanent, including during modal and
drawer scroll isolation. Mantine scroll areas keep their vertical gutter at all
times; AppShell avoids double scrollbar compensation. Dialogs use top anchoring.

Loading, empty, failed and hydrated views now share reserved geometry across
authentication, discovery, search, catalog detail types, profiles, activity, list
screens and pickers. Detail/profile headers are shared with route previews;
canonical rows remain visible while live queries attach. Artwork, text, counts,
independent status badges and permission-dependent actions retain their slots.
Search provider arrivals and incoming activity preserve existing row positions;
Refresh order / Show latest explicitly apply the latest ranking or time order.
The ordering helper stores UI IDs only, not duplicate server entities.

The browser regressions exercise delayed state/provider/detail/profile/list data,
late images, independent Seen/Liked updates, live profile edits, incoming activity,
permission arrival, real classic native scrollbars, and modal/drawer transitions.
They compare exact rectangles and reject every raw layout-shift event, including
recent-input shifts. Development layout telemetry retains full numeric precision;
the performance harness can report affected static element geometry with no text,
URLs, DOM IDs or user fields. See [UI conventions](ui.md) and
[profiling instructions](observability.md).

Validation: formatting, type-aware lint, native TypeScript and all 76 unit tests
pass. All 71 isolated PostgreSQL integration cases and the full 94-case
mobile/desktop Chromium production-browser suite pass. The latter includes 24
strict layout cases with exact rectangles and raw shift values, covering failed
requests, retry and automatic notification dismissal as well as successful data
arrival. Both development observability cases pass. The final complete synthetic
browsing run at 4× CPU throttling recorded 15,543 events, zero layout-shift events
and zero browser errors. It includes cold/prepared/cached details, a growing
client database, lists, activity, profiles and progressive search. These are
fixture-based measurements, not a universal browser or live-provider guarantee.

The scrollbar hit-area exception is documented against Mantine 9.7.3; thumb
dragging and keyboard scrolling remain functional. Notifications use Mantine's
top-anchored stacked layout without entry/height transitions, preserving its
queue and dismissal behavior. Production compilation passes with the existing
bundle size warning (approximately 1.37 MB minified / 416 KB gzip). No shared
database or infrastructure operations were performed.

The final mobile/desktop accessibility route-and-drawer audit also passed on a
fresh production rebuild, and representative final desktop/mobile screenshots
were visually reviewed. Screenshots remain in ignored local test artifacts.

## Cinema visual design — 2026-10-25

The shared Mantine theme now uses dark charcoal surfaces, warm yellow accents,
system-serif headings and system-sans body and catalog-card text. Navigation,
discovery, search, sign-in, lists, profiles and asynchronous sections share the
same framing and typography. Poster-led catalog cards retain independent full-width
rating, Seen and Liked slots, including in narrow multi-column grids.

Movie and person details share a framed artwork hero. Person screens have portrait,
life-fact cells and a larger reserved biography viewport. Their filmography tabs
are present during cold loading and preserve selection through hydration. Detail
sections use canonical route kind; skeleton and hydrated collections retain the
same mounted scroll viewport. Decorative artwork stays outside document flow.
No application APIs, canonical collections, commands or database schema changed.

Browser regression coverage now includes exact movie and person hero/section
rectangles during cold hydration, delayed movie/person artwork, and person
screens at 320px and 768px. Image assertions distinguish decorative artwork from
the meaningful poster or portrait. Strict raw zero-shift assertions are retained.

Validation: `bun run check` passes formatting, lint, native types and all 76 unit
tests. The production build and full 100-case mobile/desktop browser suite pass,
including 30 strict layout cases and accessibility/responsive checks. A subsequent
four-case cold movie/person run also passes after enriching the person response
with synthetic life facts and a long biography, while keeping the hero in view
during shift observation. All rectangles remain exact and raw shift arrays empty.
Representative movie/person layouts were visually reviewed at narrow and tablet
widths. The existing production bundle-size warning remains (approximately
1.38 MB minified / 417 KB gzip). No shared database or deployment operations ran.

## Playful movie-night styling — 2026-10-25

The visual direction now uses bold system-sans headings, rounded surfaces, pill
controls and brighter yellow, violet, pink and cyan accents. Shared cards have
fixed colour strips; movie/person heroes use ticket edges and popcorn/sparkle
stickers. Discovery and sign-in carry the same cinema-ticket motif. Navigation
destinations and reactions have distinct colours while retaining their existing
labels, focus behavior and command semantics.

All decoration uses Mantine components and supported props. Artwork stickers are
bounded within the artwork frame; ticket strips and cutouts stay outside document
flow. Dimension/position props explicitly reference existing spacing variables.
The shared forced-dark theme uses one primary shade so automatic filled-label
contrast matches the rendered background. The violet type filter uses a darker
explicit shade. Responsive regressions now verify every discovery sticker edge
stays inside its artwork at 320px and 768px, and accessibility checks exercise
each selected reaction as well as ordinary route/drawer states.

Validation: formatting, lint, native TypeScript and all 76 unit tests pass; the
production build passes with the existing bundle-size warning. The full browser
run passed 98 cases and exposed two contrast failures, which were corrected.
The subsequent geometry/workflow run passed all 30 strict layout cases, both
320px/768px responsive cases and both registration/tagging/list workflows.
Expanded mobile/desktop accessibility audits then passed after setting the shared
black/white luminance crossover, including all four selected reactions and every
existing route/drawer audit. Representative movie/person screenshots were visually
reviewed. No test tolerances, exclusions or functionality were weakened.
