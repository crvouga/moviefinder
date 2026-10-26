# Verification

Run `bun install --frozen-lockfile` once. `bun run check` uses Vite+ for formatting, type-aware lint, native TypeScript checking, and fast unit/property tests. There is no independent ESLint, Prettier, tsc, or standalone Vitest pipeline.

`bun run test:integration` starts an isolated embedded PostgreSQL cluster in a temporary directory, applies the committed Atlas migrations, runs the integration project through Vite+, then stops and removes only that temporary cluster. An explicit loopback TEST_DATABASE_URL with a database name ending `_test` can reuse a disposable server (CI also checks against PostgreSQL 17). Shared DATABASE_URL is never used.

`bun run build && bun run test:e2e` verifies the real compiled UI against Bun/Hono, persisted Better Auth, isolated embedded PostgreSQL, and deterministic TMDB fixtures. Install the matching browser with `bun x playwright install chromium` when necessary. Mobile and desktop projects cover registration, session reload, tags, catalog navigation, list editing, profile updates, searching, and cross-user SSE/reconnect. Browser failure evidence stays in ignored test-results; it contains test accounts only.

Cold-navigation coverage reloads with the bootstrap snapshot and all data APIs blocked, leaving
the client DB empty. It then holds enrichment animation callbacks and activates every primary
navigation link, verifying the destination heading appears before its live queries mount.
Separate checks cover cached detail graphs, blocked images, back/forward, search edits and filters.
A production-browser check measures pointer/keyboard input through the destination's next rendering
opportunity under 4× CPU throttling, with bootstrap and all data APIs held. Every primary destination
must stay below 100 ms and request no additional screen scripts.

Unit/property coverage exercises canonical identity, missing-field normalization, credit/season/episode links, canonical serialization, compound filter/cursor validation, permissions, dense ordering keys, redirect safety, replay revision gating, and upstream Retry-After/errors.

Integration coverage uses real transactions for authentication tables, unauthorized APIs/origins, field independence, operation deduplication, list permissions/invitations, concurrent additions/moves, public copies, audience-filtered replay, cache-first query hydration, durable request deduplication, preservation of hydrated source data, and transactional snapshots.

`bun run db:validate` checks migration hashes. Atlas application is also exercised on a fresh database by each isolated test run. Docker verification must build the actual multi-stage image, run its Bun process with runtime configuration, and request `/health`. A live TMDB smoke test is separate from deterministic suites and must report a missing credential or upstream error as a missing check.

One `Check` workflow runs three parallel required jobs on pull requests, merge queues, and main: `fast` (formatting, lint, types, unit tests, migration hashes, embedded database lifecycle), `integration` (PostgreSQL 17 API tests and schema replay/comparison), and `browser-and-container` (production build, mobile/desktop browser tests, native linux/amd64 image build and runtime smoke). These job names match the platform's required status checks. The same suite can run manually and every week. Toolchain setup is shared in `.github/actions/setup/action.yml`; installs use the frozen Bun lockfile, and Playwright uses the installed package without downloading a replacement CLI.

On main pushes, publishing through the platform's reusable workflow starts only after all three jobs pass. Main runs serialize through publishing so concurrent builds cannot race to update `latest`; newer PR runs cancel superseded PR runs. Validation jobs have explicit time limits. Production migrations and live catalog smoke remain separate manual operations, so deterministic checks need no shared credentials. The live catalog workflow obtains only the TMDB variable via short-lived GitHub OIDC; no persistent repository Vault token is used.

Actual verification results and any outstanding limits are recorded in docs/implementation-status.md at handoff. Do not infer successful production deployment from local fixture or container tests.

The container smoke helper defaults to linux/amd64; set CONTAINER_PLATFORM=linux/arm64 only to verify a native ARM image. An ARM smoke pass must never be reported as an x64 runtime pass. Production dependency installation omits unused optional/peer packages; the final runtime selects the target Bun architecture.

`bun run test:local-database` exercises the real embedded PostgreSQL package in a temporary directory: Atlas bootstrap, Better Auth registration, safe attachment to a running local cluster, shutdown, persistence across restart, and rejection of a nonlocal migration target. It does not use Vault, shared DATABASE_URL, Docker, or the developer's persistent `.local/` data. CI runs this alongside the existing PostgreSQL integration suite. Platform binary postinstall scripts are explicitly trusted so package-required library symlinks are generated on fresh installs.

Local schema generation/verification also uses embedded PostgreSQL: committed migrations replay into a temporary application database and Atlas normalizes the desired schema in a separate temporary scratch database. Both are cleaned up. This keeps Atlas diff/checks independent of Docker and the developer's `.local/` cluster. Docker remains necessary only for container-image verification.

Authentication fixtures use Mockingbird's Google OAuth profile (`@crvouga/mockingbird-service-oauth`, development dependency). Tests perform public S256 PKCE and real signed-token verification through the same Better Auth callback as the shared relay. Browser tests drive the emulator's documented account creation and consent controls; they never enable password login or use real Google/Vault credentials. Database lifecycle and application integration fixtures also authenticate through Mockingbird. Dedicated adversarial relay tests remain for invalid signatures/claims and single-use transaction rejection. The Google-only screen is checked on mobile and desktop for its official asset, preserved aspect ratio, keyboard focus, errors, cancellation, and absence of credential fields; integration tests assert all credential endpoints return 404.

The Mantine browser checks run axe WCAG A/AA scans on sign-in, discovery, the
filter drawer, search, lists, activity, profiles, movie/TV/person/season/episode
details and the unknown-route state at both configured viewport sizes. They also
verify horizontal overflow, drawer focus restoration, tab keyboard navigation,
mobile shell visibility, date filter serialization and reduced-motion feed controls.
A separate layout case checks the main routes and filter drawer at 320 px and 768 px.
Scans are automated coverage, not a complete accessibility certification.
`tests/unit/ui-architecture.test.ts` guards Mantine dependency, provider, theme,
primitive and styling boundaries; approved functional CSS exceptions are listed
in [UI conventions](ui.md).

`layout-stability.spec.ts` holds authenticated data responses and checks exact
positions during discovery, detail and profile hydration, artwork decoding, viewer
badges and live profile edits. It observes every `layout-shift` event without the
recent-input exclusion or rounding. It opts out of headless Playwright's default
`--hide-scrollbars` flag, forces a real 16px classic gutter for the desktop case,
and verifies short/long pages, modal/drawer open/close and background wheel isolation.
