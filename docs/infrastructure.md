# Shared infrastructure integration

The authoritative guide is https://www.chrisvouga.dev/llms.txt. Re-fetch it before each infrastructure operation. Inventory in crvouga/workspace takes precedence. This repository never provisions shared Vault/PostgreSQL/Railway/Cloudflare infrastructure, database/schema allocations, or control-plane credentials. At the user's request, local development runs an independent embedded PostgreSQL cluster; it never connects to shared PostgreSQL.

## Verified ownership and current boundary

The target repository is `crvouga/moviefinder`. Its original checkout contained only SPEC.md. At implementation time, the published inventory has three older MovieFinder services owned by `moviefinder.app-rust`, `moviefinder.app-react`, and `moviefinder.app-clojurescript`. None names this repository, and no explicit `moviefinder` application schema allocation is recorded for this target. Those deployments have been preserved.

Shared development diagnostics read only application catalog metadata through `bun run db:check`. No shared PostgreSQL DDL or write has been performed by this implementation. Automated local database verification uses isolated temporary embedded PostgreSQL clusters, or an explicit validated loopback TEST_DATABASE_URL. An available shared DATABASE_URL is not allocation authorization.

The approved platform change must allocate the `moviefinder` schema in both development and production, with separate environment-selected connection contracts. The existing DATABASE_URL must remain opaque and must not be replaced globally to repurpose another app's database. All authentication, catalog, user, event, and collaboration tables live inside the allocated schema. No extension is required. Atlas revision metadata also stays in that schema.

## Secrets and plain configuration

| Name                            | Source / status                                                                                           | Purpose                                               |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| DATABASE_URL                    | Existing Vault personal/dev and personal/prd contract; approval pending workspace PR #84                  | Opaque PostgreSQL connection                          |
| TMDB_API_READ_ACCESS_TOKEN      | Existing contract; development live read verified                                                         | Server-only TMDB requests                             |
| MOVIEFINDER_AUTH_SECRET         | New generated Vault field proposed in workspace PR #84; legacy local BETTER_AUTH_SECRET remains supported | Project-specific session/auth cryptography            |
| MOVIEFINDER_OIDC_ISSUER         | Public setting from an approved shared relay registration                                                 | Environment-specific OIDC discovery                   |
| MOVIEFINDER_OIDC_CLIENT_ID      | Public setting from the same registration                                                                 | Public S256 PKCE client; no client secret             |
| MOVIEFINDER_ORIGIN              | Plain environment; localhost:5173 for development, approved HTTPS origin for production                   | Better Auth origin/callback/CSRF                      |
| MOVIEFINDER_ADDITIONAL_ORIGINS  | Plain comma-separated exact HTTPS origins; www.moviefinder.app is additive                                | Independent auth/callback/CSRF per configured host    |
| MOVIEFINDER_DATABASE_ALLOCATION | Plain confirmation of approved `moviefinder` allocation                                                   | Migration guard; not a substitute for actual approval |
| PORT                            | Plain, 8080                                                                                               | Single public Bun port                                |

Reuse shared keys where appropriate; do not copy another app's OAuth credentials or authentication URL. New key names and environment parity must be registered through the workspace OpenTofu Vault inputs/inventory. Never print values. Runtime fleet services receive declared secrets directly from OpenTofu; they do not fetch Vault at boot. Local scripts use the supported vault run wrapper.

Google sign-in uses the shared relay's application registration API/UI, separately from infrastructure provisioning. [The setup guide](auth-relay.md) specifies the exact callback and public runtime settings. Registration credentials stay in tooling, outside the application process. Public OIDC settings belong in the service's plain `env` inventory after registration; this repository does not modify that shared control plane.

## Image and fleet contract

- Service ID proposed for infrastructure review: `moviefinder`; do not silently repurpose a legacy service.
- Source: https://github.com/crvouga/moviefinder, default branch main.
- Requested origin: `https://moviefinder.chrisvouga.dev`, subject to central allocation/ownership review.
- Image contract: `ghcr.io/crvouga/chrisvouga-moviefinder:<git-sha>` and latest through the reusable shared workflow.
- Dockerfile/context: `./Dockerfile`, `.`. Three build/runtime dependency stages plus pinned Bun image source; one final stateless Bun process, unprivileged user, port 8080.
- Liveness: `GET /health` → 200, independent of database, Vault, TMDB, and user authentication.
- Readiness: authenticated `GET /api/ready`; PostgreSQL unavailable → 503.
- Stateful work: PostgreSQL only; no disk, Redis, broker, R2, or Turborepo service required.
- SSE: yes; preserve streaming and disable response buffering. The server sends heartbeats and honors event cursors.
- Termination: SIGTERM cancels background work, closes live streams, drains HTTP, closes pool.
- Capacity: initially small personal deployment; bounded five-connection pool and two claimed jobs.

The `publish` job in `.github/workflows/check.yml` calls the platform's reusable GHCR publishing/deploy-dispatch workflow after all three validation jobs pass on a main push. This repository owns its workflows (`managed_publisher = false` in the platform inventory); it has no separate publisher workflow. Do not publish images manually, use Railway builds, run railway up, or change Railway/DNS outside inventory. Build without secrets. Runtime configuration is never copied into the image. The optional live smoke workflow uses GitHub OIDC with exportEnv:false and exposes only the requested key to its single command.

The first main publish run [built and pushed the image but failed deployment notification](https://github.com/crvouga/moviefinder/actions/runs/38994345928) because this repository has no `DEPLOY_DISPATCH_TOKEN`. [Workspace PR #84](https://github.com/crvouga/workspace/pull/84) is merged, but its [foundation provisioning run failed](https://github.com/crvouga/workspace/actions/runs/38996724204) trying to import the nonexistent `moviefinder:production` GitHub environment. The platform must correct environment adoption in `packages/infra/tofu/foundation/repository.tf` and apply foundation provisioning to supply the managed dispatch credential before publishing can complete. Keep missing credentials fatal; do not disable deployment notification or inject control-plane credentials manually to make CI green. After provisioning, rerun the failed `Check` publish job (or the original `Publish image` run for its existing commit).

## Migrations and rollout

1. Infrastructure owners approve allocation and register required secret names/configuration. Record the approved change as evidence.
2. Confirm the selected dev/prd URL belongs to the app's allocated environment without logging it. Do not run local processes against production.
3. Review deterministic Atlas SQL and the additive migration strategy. Existing legacy apps/tables are not migrated, renamed, or removed by this change.
4. Run migration validation and status. Apply only with the approved allocation confirmation through `vault run`. Atlas is the sole migration authority, including Better Auth tables. Application startup never runs DDL.
5. Publish through the shared reusable workflow after source integration. Central OpenTofu selects that prebuilt image and binds only declared runtime variables.
6. Verify public liveness, authenticated readiness, registration/session reload, live catalog ingestion, and two-user list propagation at the approved origin.
7. Roll back application image through the central workflow if necessary. Additive database changes remain compatible; do not automatically drop user/catalog/auth tables to roll back.

The desired SQL model declares the schema for disposable Atlas normalization. Application migrations contain table changes only and assume the infrastructure-owned namespace already exists. Migration generation uses a temporary embedded database populated by committed Atlas migrations, then Atlas schema diff; it does not require a paid baseline feature and does not inspect shared data.

## Local embedded PostgreSQL

`bun run dev` starts a per-checkout PostgreSQL cluster with `embedded-postgres`, creates its local database/schema, and automatically applies the committed Atlas migrations before starting the app. The connection is generated locally and replaces any Vault DATABASE_URL in child processes. Data and generated local credentials stay in ignored `.local/`, excluded from Git and Docker contexts. PostgreSQL binds only to loopback, and Stop preserves its data for the next run. No shared schema allocation flag or Docker daemon is required for local development.

`db:migrate`, `db:status`, `db:check`, and `db:drift` default to this local database. Shared operations are explicitly named `db:migrate:shared`, `db:status:shared`, `db:check:shared`, and `db:drift:shared`. They load Vault configuration and retain the existing allocation guard. Do not pass shared URLs to the local launcher or copy shared data into local development.

The previously reported missing `moviefinder.user` error came from using an unprovisioned shared database during local startup. That path is replaced by automatic embedded setup. The inventory allocation requirements above remain prerequisites for shared deployment only.

## Hosting request

A complete request is maintained in docs/hosting-request.md after container verification. Check existing workspace issues before submission. Deployment remains unverified until an approved inventory change, available published image, required runtime secrets, applied shared migrations, and live health smoke have all succeeded. Local image or fixture tests are not deployment evidence.

## Production rollout request

The infrastructure change is [workspace PR #84](https://github.com/crvouga/workspace/pull/84).
The application change is [MovieFinder PR #1](https://github.com/crvouga/moviefinder/pull/1).
The platform PR declares this repository as the owner of the new service and
`moviefinder` schema, adds a namespace-only OpenTofu resource, registers a newly
generated app-specific auth secret and retains application-owned publishing and
validation. Existing deployments and schemas remain separate targets.

The production migration workflow is `.github/workflows/migrate.yml`. After the
platform allocation is merged and applied, run **Migrate production database**
on application `main`. It reads the merged platform inventory to verify schema
ownership, uses GitHub OIDC to request only the production DATABASE_URL, validates
the committed Atlas migrations and applies them inside the approved namespace.
It never runs as part of local startup, image building or a pull request.
The shared database also holds other applications' schemas, so everything this project does is
confined to `moviefinder`. Atlas apply/status receive a URL with `search_path=moviefinder`
(`src/server/db/scope.ts`); an unscoped URL makes Atlas reject the database as "not clean" and apply
nothing. Application SQL is always schema-qualified, and the integration database runs with an
empty `search_path` so any unqualified reference fails. Other schemas are never inspected or
modified.

On every push to `main`, `.github/workflows/check.yml` runs this same workflow (`migrate` job) after
all validation jobs pass and before `publish`, so a new image is never released against an older
schema. A failed migration blocks publishing. The workflow can still be dispatched manually.
The opaque dev/prd DATABASE_URL contracts currently resolve to the same platform
foundation database; this request does not provision separate physical databases.
Local development and automated tests remain isolated in embedded PostgreSQL.

The clean platform checkout cannot produce a real saved plan without its state
passphrase/backend credentials. Its existing live ruleset also differs from the
already-declared Fleet/merge-queue policy. These are recorded on the platform PR;
no dashboard mutation or shared database write is used to bypass them.
