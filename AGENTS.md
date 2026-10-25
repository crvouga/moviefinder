# MovieFinder

Implement the requirements in [SPEC.md](SPEC.md). Read [README.md](README.md) and the relevant docs before changing domain behavior.

Shared infra (Vault, PostgreSQL, R2, hosting): https://www.chrisvouga.dev/llms.txt
Re-fetch that guide before infrastructure operations. The crvouga/workspace OpenTofu inventory is authoritative. Never migrate or write to shared PostgreSQL until the moviefinder schema allocation is explicitly approved. Never modify shared control-plane resources from this repository. Existing deployments in other repositories are separate targets; preserve them.

Local development and default isolated database tests use the user-requested `embedded-postgres` package. `bun run dev` starts a loopback-only PostgreSQL cluster under ignored `.local/`, applies Atlas migrations, and stops the cluster with the dev servers while preserving data. Local commands ignore shared DATABASE_URL. Default db:check/db:migrate/db:status/db:drift target embedded PostgreSQL; explicit :shared variants use Vault and retain allocation safeguards. Never copy local credentials/data into source, images, or shared environments. `bun run test:local-database` verifies embedded persistence and shutdown in an isolated temporary directory.

Use `bun run check` for native TypeScript checking, Oxlint, Oxfmt, and fast deterministic tests through Vite+. Use `bun run build`, `bun run test:integration`, and `bun run test:e2e` for the appropriate verification layer. Integration/browser scripts create isolated temporary embedded PostgreSQL unless a validated loopback TEST_DATABASE_URL is supplied. Never use DATABASE_URL for automated tests.

When debugging local slowness or runtime behavior, read `bun run telemetry` (see docs/observability.md) and reproduce with `bun run perf` before guessing. Telemetry is development-only and must stay free of secrets and personal data.

Atlas exclusively owns migrations. Update atlas/schema.sql and generate a migration with Atlas; keep Drizzle definitions aligned. No Drizzle Kit or Better Auth migration runner. Commit atlas.sum with migrations. Do not add schema creation to application migrations: OpenTofu owns the allocation.

All TMDB HTTP requests belong in entity-store-sync. Preserve source JSON separately from normalized client projections. Never treat a locally matching subset as a complete provider result page. All server entities live in TanStack DB query collections. Use Hono RPC commands with optimistic transactions and stable operation IDs. Do not introduce parallel component caches of entities, spinning indicators, anonymous application access, or private lists.

Preserve commit ordering of durable events and atomicity with mutations. Keep list edits item-based; never replace the whole ordering array. Verify permission boundaries on the backend.

Secrets must never appear in source, output, images, artifacts, test evidence, or documentation. .vault.yaml contains only coordinates. Runtime configuration is environment-based. Production runs one Bun server and accepts only its explicitly configured origins, with independent host-only authentication cookies and exact registered callbacks.

## PR attestations

Handle PR attestations autonomously. Inspect the diff and gather available evidence. Update only truthful claims. If evidence, access, or sign-off is unavailable, leave the claim unchecked, document the precise blocker, and continue independent work. Never fabricate evidence or bypass a gate, and never ask the user to provide evidence solely to clear an attestation gate.
