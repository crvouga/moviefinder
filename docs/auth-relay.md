# Google sign-in through the shared relay

MovieFinder uses the shared Google-to-OIDC relay described in the [consumer guide](https://www.chrisvouga.dev/llms.txt) and its [current source](https://github.com/crvouga/workspace/blob/main/llms.txt#6-auth-relay-google-sign-in). Current canonical inventory declares `enabled: true`, `live: true`, with status `preproduction`. Nonproduction discovery returned HTTP 200 with the expected issuer. These observations do not establish production acceptance; consult the platform's [acceptance record](https://github.com/crvouga/workspace/blob/main/packages/auth-relay/acceptance.md).

MovieFinder receives no Google credentials, relay manager/setup credentials or OIDC client secret. The existing MovieFinder auth secret continues to secure its own sessions. Google is the only authentication method. Missing relay settings fail production startup; development may start with sign-in unavailable. There is no password fallback. Password registration, email/username sign-in and password recovery endpoints are disabled on the server. Partial or environment-mismatched OIDC configuration fails startup.

## Registration and runtime configuration

Register the application in the matching relay console, or use the platform's [scoped registration client](https://github.com/crvouga/workspace/blob/main/packages/auth-relay/agent.ts) with an operator-approved credential. Use project `moviefinder`, a distinct immutable instance for each concurrently running server/preview, the appropriate environment (`localhost`, staging/preview or production), and an explicit expiry within its grant. Do not copy another application's client ID. Exact callbacks are:

| Deployment                 | Issuer                                                | Callback                                                          |
| -------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| Production                 | `https://auth.chrisvouga.dev/realms/projects`         | `https://moviefinder.chrisvouga.dev/api/auth/callback/auth-relay` |
| Local example on port 5173 | `https://auth-dev.chrisvouga.dev/realms/projects-dev` | `http://localhost:5173/api/auth/callback/auth-relay`              |

Set `MOVIEFINDER_OIDC_ISSUER` and `MOVIEFINDER_OIDC_CLIENT_ID` to the registration's returned public settings. The callback always derives from `MOVIEFINDER_ORIGIN` plus `/api/auth/callback/auth-relay`; the requested scopes are `openid email profile`. Both settings must come from the same registration/environment. Production and nonproduction registrations, clients and issuers are independent. MovieFinder does not configure provider logout; signing out revokes the application session.

For production, the infrastructure owner adds the two public settings to the `moviefinder` service's plain `env` in `crvouga/workspace`, then follows the platform release workflow. Callback registrations are runtime relay application data; they never belong in OpenTofu inventory. No database migration is needed for this integration: Better Auth's existing account, session and verification tables are reused.

Local startup normally selects an available port. Registered callbacks must keep their exact port.

Registration tooling can save the returned public connection settings under ignored `.local/auth-relay.json` with `issuer`, `clientId`, `callbackURL` and ISO `expiresAt` fields. `bun run dev` reads this record automatically, selects the registered port and injects the two OIDC settings into its children. No credentials belong in this file. Expired or malformed records fail clearly. Explicit OIDC environment configuration overrides this saved record; an explicit web port must match its registered callback. With a saved record, ordinary `bun run dev` needs no OIDC environment variables. Without a saved record, configure an approved registration explicitly:

```sh
MOVIEFINDER_WEB_PORT=5173 \
MOVIEFINDER_OIDC_ISSUER=https://auth-dev.chrisvouga.dev/realms/projects-dev \
MOVIEFINDER_OIDC_CLIENT_ID=<returned-public-client-id> \
bun run dev
```

Replace the client ID placeholder before running. A busy explicit port fails instead of silently changing the callback. Each concurrent instance needs its own registration and port. If a port changes, update the exact callback through the console or the scoped helper before signing in. `localhost` and `127.0.0.1` are different destinations. Nonproduction registrations expire within seven days; production within 366 days. Renew registrations before expiry.

Agent automation requires an exact platform-issued credential path/id and an approved grant for this project, environment, origins/loopback ports and expiry. Vault metadata currently contains no `auth-relay-agents/` credential documents. The ordinary `personal/dev` Vault projection contains neither MovieFinder OIDC settings nor `AUTH_RELAY_AGENT_TOKEN`. An authorized operator can also register clients using the console's same-origin `/api/clients` API with its existing session and CSRF protection. The platform guide reserves the initial operator claim for a manual action; the human completed it on 2026-10-24. The authorized operator API then registered this checkout and its returned public settings were saved locally. Google sign-in alone never authorizes registration. Keep scoped registration credentials exclusively in helper processes, outside the MovieFinder server, frontend, image, logs and artifacts.

## Authentication boundaries

The browser performs a top-level redirect. Better Auth generates random state, nonce and S256 verifier; each ten-minute transaction has its own signed HttpOnly, SameSite=Lax cookie and PostgreSQL record. Transaction identifiers bind issuer, client ID and exact application origin. The callback consumes the record atomically, refuses replay, and never retries a code exchange. Session/transaction cookies include the application name and an origin-derived instance namespace because localhost ports share cookies. Production cookies are Secure and host-only. The cookie namespace change requires existing browser sessions to sign in again once; persisted accounts remain usable.

Discovery and JWKS caches have five-minute freshness bounds; unknown signing keys trigger JOSE's bounded refresh with a cooldown. Endpoint requests reject redirects and have ten-second timeouts. ID tokens require an RS256 signature, exact issuer/audience, expiry, issue time, per-flow nonce, stable subject and verified email. Client-submitted ID-token login, refresh grants and automatic account linking by email are disabled. The provider account key contains `(issuer, subject)`; email is a profile attribute. An existing password-era account sharing a Google email is never implicitly merged. Such accounts require a separately reviewed ownership migration; their credential endpoints remain disabled.

Established application sessions query MovieFinder's database without a relay lookup, including after an application restart during relay downtime. New sign-ins fail closed and display a retry message. Google identities grant ordinary application membership; backend ownership and list permissions still govern mutations.

## Verification

`bun run check` covers configuration and cookie instance isolation. `bun run test:integration` uses temporary embedded PostgreSQL and a loopback OIDC fixture with real RS256 signatures. It exercises code/S256 exchange without secrets, persisted sessions/restart during provider outage, per-tab cookies, simultaneous replay, missing/wrong cookies, expired state, cross-instance callbacks, invalid issuer/audience/nonce/expiry/verified-email claims, existing-email collision, direct ID-token rejection and failed exchange without retries. Fixture sign-in is never live Google evidence.

Before rollout, read back the approved registration, confirm both public settings and its exact callback, then use a fresh browser to sign in with real Google, reload the app, sign out, and retry a protected deep link. Verify two tabs and two registered local instances. Record only safe outcomes and browser versions; never capture callback URLs containing codes/state, cookies or tokens.

On 2026-10-24, live Google-backed sign-in succeeded in the super.engineering WebKit browser through an existing Google/relay session. The verified MovieFinder session survived page reload and a complete local server/database restart. Sign-out restored unauthorized API responses, and another Google sign-in restored a protected `/lists` deep link. A second registered localhost instance with a disposable database confirmed independent sessions in the same browser: it started signed out, completed Google sign-in independently, and signing out there preserved the first instance's session. Its temporary client was revoked and the instance/database were removed after verification. This checkout is configured under ignored `.local/auth-relay.json`; its nonproduction registration expires on 2026-10-31. Renew it through the operator API before expiry. Production MovieFinder configuration, fresh Google consent in a new browser profile, unrelated public domains and the complete browser/reliability acceptance matrix remain unverified.

## Google-only interface and test identity

The sign-in page offers a single Google action. It uses the unmodified light rectangular Android/Web PNG from Google's [pre-approved sign-in asset bundle](https://developers.google.com/identity/branding-guidelines), downloaded on 2026-10-24. `public/brand/google-signin-light.png` retains the official logo, text, font, colors, border and padding; its 720×160 image is displayed at 216×48 with the same aspect ratio. The accessible button name matches the asset, **Sign in with Google**. Focus is visible, requests prevent duplicate activation, and failures offer retry. No Google SDK client ID or Google secret is exposed to MovieFinder.

Automated application, browser, observability and database lifecycle tests use `@crvouga/mockingbird-service-oauth` with `provider: "google"`. The pinned development dependency serves loopback discovery, signed RS256 tokens, exact callbacks, public S256 PKCE, account selection and consent. Browser suites complete its documented chooser/signup/consent screens and use ordinary authenticated profile commands for fixture usernames. Synthetic identities and isolated embedded PostgreSQL replace real Google/Vault/shared data. This emulator is imported only by test fixtures and the explicitly synthetic performance script. Development and production continue to use the real shared relay; HTTP test issuers are accepted only under `NODE_ENV=test`. The separate adversarial relay suite injects invalid signatures/claims and replay conditions to verify rejection at the authentication boundary.
