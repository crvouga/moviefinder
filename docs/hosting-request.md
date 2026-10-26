# Prepared shared-platform change request

Status: implementation submitted as [MovieFinder PR #1](https://github.com/crvouga/moviefinder/pull/1), with the platform change in [workspace PR #84](https://github.com/crvouga/workspace/pull/84). Production is not deployed. Image publication and approved platform plan/application remain rollout prerequisites. The three legacy MovieFinder services are preserved.

Suggested issue title: `[hosting] moviefinder — approve isolated social discovery allocation and Bun service`

## Service

| Field              | Value                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| Service id         | `moviefinder` — proposed; central inventory/ownership review required                                         |
| Summary            | Authenticated movie/TV discovery with personal opinions, public profiles, and collaborative realtime lists.   |
| Source repo        | `crvouga/moviefinder` (public), default branch `main`                                                         |
| Source code URL    | https://github.com/crvouga/moviefinder                                                                        |
| Requested hostname | `moviefinder.chrisvouga.dev`, subject to approval against existing MovieFinder deployment roles               |
| Kind               | HTTP server serving React, Hono APIs, Better Auth, and SSE                                                    |
| Stack              | TypeScript 7.0.2, React 19.3.1, Vite+ 1.2.0, Hono 4.13.13, Better Auth 1.7.10, Bun 1.4.2; Bun package manager |

## Image

| Field              | Value                                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Image source       | Shared reusable publish workflow → `ghcr.io/crvouga/chrisvouga-moviefinder`                                                                    |
| Image reference    | `ghcr.io/crvouga/chrisvouga-moviefinder:<approved-git-sha>` and `:latest`; not published yet                                                   |
| Already published? | No. Local image build exists; publication must follow source integration and the shared workflow.                                              |
| Dockerfile         | `Dockerfile`                                                                                                                                   |
| Build context      | `.`                                                                                                                                            |
| Platform           | `linux/amd64` image builds; native x64 runtime verification must run in CI. Local CPU emulation crashes inside Bun before application startup. |
| Publish workflow   | `publish` job in `.github/workflows/check.yml`, gated on all three validation jobs                                                             |
| Image size         | 84.9 MiB AMD64 / 86.2 MiB ARM64; exact byte counts are recorded in implementation-status.md                                                    |

## Runtime

| Field              | Value                                                                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Port               | `8080`, reads `PORT`, default `8080`                                                                                                                                                      |
| Health path        | `/health` → 200, no auth or third-party calls                                                                                                                                             |
| Boot time          | Native process becomes live within seconds; see actual container evidence in implementation-status.md                                                                                     |
| Start command      | `bun src/server/index.ts`                                                                                                                                                                 |
| Plain env vars     | `NODE_ENV=production`, `PORT=8080`, `MOVIEFINDER_ORIGIN=https://moviefinder.chrisvouga.dev`; after approval `MOVIEFINDER_DATABASE_ALLOCATION=moviefinder`; optional verified `EMAIL_FROM` |
| Websockets / SSE   | SSE yes; no WebSockets in production. Do not buffer SSE responses.                                                                                                                        |
| Background work    | Bounded PostgreSQL sync queue with leases, retry schedules, shared provider cooldown, and selective warming. No external scheduler/broker.                                                |
| Persistent disk    | None                                                                                                                                                                                      |
| Memory / CPU needs | Small initial deployment; five-connection PostgreSQL pool, two claimed jobs per worker; measure actual traffic before scaling.                                                            |
| Graceful SIGTERM   | Yes; stop sync, close streams, drain HTTP, end pool.                                                                                                                                      |

## Secrets and shared infra

Names only — never values.

| Env var                          | Already in Vault personal?                             | Configs                      | Purpose / source                                                                                 |
| -------------------------------- | ------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------ |
| DATABASE_URL                     | Yes; application allocation not approved               | dev, prd                     | Opaque application-facing PostgreSQL contract                                                    |
| TMDB_API_READ_ACCESS_TOKEN       | Yes; development live API contract verified            | dev, prd                     | Server-only catalog read token                                                                   |
| MOVIEFINDER_AUTH_SECRET          | New generated key proposed by workspace PR #84         | dev, prd                     | Existing compatible authentication secret, or managed value through the OpenTofu secrets process |
| RESEND_API_KEY                   | Existing production contract; absent in development    | dev, prd if recovery enabled | Optional Resend delivery with verified EMAIL_FROM                                                |
| MOVIEFINDER_GOOGLE_CLIENT_ID     | Not verified; optional new app-specific registered key | dev, prd if enabled          | Google OAuth app registered for this approved origin                                             |
| MOVIEFINDER_GOOGLE_CLIENT_SECRET | Not verified; optional new app-specific registered key | dev, prd if enabled          | Google OAuth app secret                                                                          |

- PostgreSQL: required. Allocate `moviefinder` schema for this repository in both dev and prd. Preserve environment isolation and the existing opaque DATABASE_URL contract. No extension is needed. Do not replace a shared URL to repurpose another app's allocation.
- Authentication, catalog JSONB/source metadata, coverage, jobs/checkpoints, tags, saved feeds, lists/items/members/invitations, follows, activities, operation receipts, and events all belong inside `moviefinder`.
- Migrations: Atlas exclusively; no startup DDL. After allocation approval, use `vault run -- bun scripts/migrate.ts status` and then guarded `vault run -- bun scripts/migrate.ts apply`. Keep `atlas_schema_revisions` inside `moviefinder`. Initial and subsequent migrations are additive; preserve existing legacy app tables/deployments.
- Object store: not required; key prefix n/a.
- Turborepo cache: not used.
- Vault CI OIDC: used only by optional live catalog smoke. Reuse role github-actions, audience https://vault.chrisvouga.dev, personal path; no stored repository Vault token.
- Runtime: declare only required secret names in the fleet inventory. No boot-time Vault fetch.

## Local verification

Actual evidence, including architecture distinctions, is maintained in implementation-status.md. Commands:

```sh
bun run check
bun run build
bun run test:integration
bun run test:e2e
bun run db:validate
bun run db:verify
vault run -- bun scripts/smoke.ts

docker build --platform linux/amd64 -t moviefinder:verification .
bun scripts/container-smoke.ts moviefinder:verification

docker build --platform linux/arm64 -t moviefinder:verification-arm64 .
CONTAINER_PLATFORM=linux/arm64 bun scripts/container-smoke.ts moviefinder:verification-arm64
```

The container smoke injects disposable process-only test values, uses an intentionally unreachable PostgreSQL address, and verifies liveness/authentication/static-serving boundaries. It never uses shared credentials or modifies a shared database. Local x64 runtime verification is currently blocked by the documented Bun crash in CPU emulation; do not mark it passed. The deep-validation workflow runs the same smoke on a native x64 runner.

## Portfolio entry

| Field             | Value                                                                                                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List it?          | Yes — main list after approved successful deployment                                                                                                                                                                        |
| Project id        | `moviefinder`                                                                                                                                                                                                               |
| Title             | MovieFinder                                                                                                                                                                                                                 |
| Setting           | side                                                                                                                                                                                                                        |
| Deployment        | not-deployed-yet                                                                                                                                                                                                            |
| Code              | public: https://github.com/crvouga/moviefinder                                                                                                                                                                              |
| Description       | Find films and TV through a mobile poster feed, record your taste, and curate public lists with friends. A selective TMDB replica, normalized reactive state, and durable event replay keep collaborative edits consistent. |
| Topics            | typescript, react, bun, postgres, react-query, mantine, zod, docker                                                                                                                                                         |
| Screenshots       | Capture from the approved deployment after rollout; local verification screenshots contain test fixtures.                                                                                                                   |
| Demo video        | none                                                                                                                                                                                                                        |
| Include on resume | no                                                                                                                                                                                                                          |
| Highlights        | Source-oriented JSONB catalog with progressive hydration; item-level concurrent lists; one Bun service and durable SSE replay.                                                                                              |

## Anything else

Current inventory entries belong to `moviefinder.app-rust`, `moviefinder.app-react`, and `moviefinder.app-clojurescript`. They were not overwritten or repurposed. Confirm this repository's intended deployment role through the approved inventory change before provisioning or cutting over a hostname. A different implementation stack alone does not authorize a duplicate application.

The immediate external requirements are approved application/schema ownership, fleet registration, registered runtime authentication secrets, source/image integration, and native x64 CI/live rollout evidence. Live recovery delivery additionally requires a configured mail key and verified sender. Optional OAuth remains disabled until app-specific credentials and callbacks exist.
