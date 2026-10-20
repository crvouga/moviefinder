# MovieFinder

A mobile-first home for finding films and TV, recording your taste, and making public collections with friends. Discovery uses a virtualized vertical Swiper feed, independent seen/sentiment controls, composable filters, and progressive catalog updates. The interface has no loading spinners.

## Run locally

Requires Bun 1.4.2, a supported Node runtime (22.22.3 used here), Atlas, and the shared platform's installed `vault` wrapper for catalog/auth secrets. PostgreSQL runs locally through [`embedded-postgres`](https://github.com/leinelissen/embedded-postgres); no PostgreSQL installation, Docker, or shared schema allocation is required to run the app.

1. `bun install --frozen-lockfile`.
2. Authenticate using the documented `vault login` workflow. This checkout's `.vault.yaml` selects `personal/dev`.
3. Run `bun run dev`, or choose **Run → MovieFinder** in super.engineering.
4. Open the `http://localhost:<port>` URL printed at startup and register an account on the first run.

Startup initializes a local PostgreSQL cluster, creates the local database/schema, applies committed Atlas migrations, and starts both development servers. Both servers use free ports chosen at each start (the URL is printed), and Vite+ proxies API requests to Bun. The database listens only on loopback, uses an available port, and persists under ignored `.local/postgres`. Generated local credentials stay in private ignored `.local/postgres.json`; they never enter Git or Docker build contexts. `bun run telemetry` summarizes timings recorded while you use the app; see [observability](docs/observability.md). Stop shuts down the development servers and their PostgreSQL process while retaining your data. A later run reopens the same database.

The local launcher always supplies its own database URL, overriding any shared `DATABASE_URL` injected by Vault. Vault still supplies the real TMDB token and authentication secret. `dev:local` starts the same embedded database when those other variables have already been injected. Shared infrastructure allocation requirements apply only to explicit shared commands and deployment.

Production requires `DATABASE_URL` and the platform-generated `MOVIEFINDER_AUTH_SECRET` (the existing `BETTER_AUTH_SECRET` remains supported for local compatibility); local development generates its database connection and still requires `BETTER_AUTH_SECRET`. Production also requires the app-specific `MOVIEFINDER_ORIGIN`. `TMDB_API_READ_ACCESS_TOKEN` enables catalog refresh; cached content remains usable during an upstream outage. `.env.example` lists variable names without values. Never reuse another application's authentication base URL.

Email/password registration works without a social provider. Recovery is enabled only with `RESEND_API_KEY` and a verified `EMAIL_FROM`. Google login appears only with app-specific `MOVIEFINDER_GOOGLE_CLIENT_ID` and `MOVIEFINDER_GOOGLE_CLIENT_SECRET`. These integrations require registered infrastructure secrets and callback/sender configuration.

## super.engineering hooks

The repository's `.super.engineering/config.json` provides the built-in hooks:

- **Setup** runs `bun install --frozen-lockfile` when super.engineering sets up the checkout.
- **Run → MovieFinder** is the default. It runs `bun run dev`, loads catalog/auth secrets through Vault, initializes/migrates embedded PostgreSQL, and starts the frontend and backend together. Open the URL it prints.
- **Run → Checks** runs the formatting, lint, native type checking, and unit/property suite with `bun run check`.
- **Run → Database check** checks local database tables/columns, starting embedded PostgreSQL as needed.
- **Run → Migrate database** applies Atlas migrations to embedded PostgreSQL; normal MovieFinder startup already does this automatically.
- **Stop** runs the explicit `scripts/stop-dev.ts` hook for MovieFinder before terminating its Run wrapper. The development supervisor stops both servers and its PostgreSQL process while preserving local data.

Authenticate with `vault login` before Run so catalog/auth secrets are available. Local startup and migrations require no shared allocation flag. The default database commands always target embedded PostgreSQL; shared operations must be invoked explicitly with `:shared` commands and retain the allocation guard.

If an older run reported missing `moviefinder.user` or allocation errors, stop it and start **MovieFinder** again. The embedded database will be initialized and migrated automatically. Existing accounts in other databases are not copied into your local database.

## Commands

| Command                             | Purpose                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `bun run check`                     | Oxfmt, Oxlint, native TypeScript 7, unit/property tests through Vite+             |
| `bun run format`                    | Format through Vite+                                                              |
| `bun run lint`                      | Lint through Vite+                                                                |
| `bun run build`                     | Production React bundle through Vite+                                             |
| `bun run test:integration`          | Isolated embedded PostgreSQL, Atlas migrations, API/concurrency tests             |
| `bun run test:e2e`                  | Isolated embedded PostgreSQL and Playwright mobile/desktop; build first           |
| `bun run test:local-database`       | Verify embedded initialization, migrations, persistence, attachment, and shutdown |
| `bun run db:migrate:shared`         | Apply shared migrations through Vault after explicit allocation approval          |
| `bun run db:validate`               | Validate Atlas migration integrity                                                |
| `bun run db:check`                  | Check local embedded database tables/columns                                      |
| `bun run db:diff change_name`       | Generate an Atlas migration from atlas/schema.sql                                 |
| `bun run db:migrate`                | Apply local embedded PostgreSQL migrations                                        |
| `bun run db:status`                 | Read local embedded PostgreSQL migration status                                   |
| `bun run db:drift`                  | Compare local embedded PostgreSQL with the desired SQL schema                     |
| `vault run -- bun scripts/smoke.ts` | Explicit live TMDB smoke check; no database writes                                |

The test scripts refuse non-loopback test URLs or database names that do not end in `_test`. Fixture upstream responses are used only by tests. Production has no mock catalog or authentication bypass.

## Architecture

One Bun/Hono process serves React, authenticated APIs, Better Auth, and SSE. Drizzle queries the allocated `moviefinder` PostgreSQL schema; Atlas owns its migrations. `entity-store` owns source JSON storage and query-time normalization. `entity-store-sync` owns every TMDB request, durable jobs, rate limiting, and refresh policies. TanStack DB query collections hold normalized browser entities and optimistic transactions.

The database retains events in the same transactions as mutations. Replay uses a global ordered cursor. A transaction-level PostgreSQL advisory lock makes event identity reflect commit order and gives item-level moves deterministic serialization. Stable item IDs and fractional keys avoid whole-list replacement.

See [architecture](docs/architecture.md), [entity store](docs/entity-store.md), [queries](docs/query-system.md), [realtime](docs/realtime.md), [testing](docs/testing.md), and [infrastructure](docs/infrastructure.md).

## Deployment status

The application is prepared for the shared GHCR/Railway workflow. **It has not been deployed to shared infrastructure.** At implementation time, the inventory contains older MovieFinder services belonging to other repositories, but no service or explicit schema allocation for `crvouga/moviefinder`. Shared migrations are intentionally unapplied. See [infrastructure](docs/infrastructure.md) for the prepared integration contract and external requirements.

Local development is ready independently of these production allocation requirements. Build the container with `docker build -t moviefinder:verification .`. Runtime secrets are supplied as environment variables, never build arguments. `/health` is public and independent of PostgreSQL. `/api/ready` and `/api/metrics` require authentication. See the infrastructure document before attempting rollout.

This product uses the TMDB API but is not endorsed or certified by TMDB. Streaming availability is attributed to JustWatch through TMDB.
