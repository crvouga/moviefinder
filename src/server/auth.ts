import { log } from "./log";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import type { Database } from "./db";
import type { Config } from "./config";
import * as schema from "./db/schema";
import { eq } from "drizzle-orm";
import { authCookiePrefix, authRelay, relayProviderId, withRelayStateCookies } from "./auth-relay";
export function createAuth(db: Database, config: Config) {
  const auth = betterAuth({
    appName: "MovieFinder",
    logger: {
      level: "error",
      log: (level) => log("auth", "Authentication operation failed", { level }),
    },
    // Let Hono sanitize unexpected errors. The auth router otherwise prints SQL and parameters.
    // Expected APIErrors still become their normal HTTP responses inside Better Call.
    onAPIError: { throw: true, errorURL: `${config.MOVIEFINDER_ORIGIN}/auth?socialError=1` },
    secret: config.BETTER_AUTH_SECRET,
    baseURL: config.MOVIEFINDER_ORIGIN,
    trustedOrigins: [config.MOVIEFINDER_ORIGIN],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: { enabled: false },
    disabledPaths: [
      "/sign-up/email",
      "/sign-in/email",
      "/sign-in/username",
      "/request-password-reset",
      "/reset-password",
      "/change-password",
      "/set-password",
      "/verify-password",
    ],
    user: { additionalFields: { bio: { type: "string", required: false, defaultValue: "" } } },
    account: {
      // Linking is enabled only so a password-era account can be claimed. The account hook
      // below rejects every other link, so an identity is still keyed by (issuer, subject).
      accountLinking: {
        enabled: true,
        trustedProviders: [relayProviderId],
        requireLocalEmailVerified: false,
      },
      encryptOAuthTokens: true,
      storeStateStrategy: "database",
    },
    databaseHooks: {
      account: {
        create: {
          async before(created) {
            const existing = await db
              .select({ id: schema.account.id, providerId: schema.account.providerId })
              .from(schema.account)
              .where(eq(schema.account.userId, created.userId));
            if (existing.length === 0) return;
            // Password sign-in is disabled, so a password-only account is unusable. A verified
            // relay email claims it: remove the password and end its sessions, keep its data.
            if (
              created.providerId !== relayProviderId ||
              existing.some((row) => row.providerId !== "credential")
            )
              return false;
            await db.transaction(async (tx) => {
              await tx.delete(schema.session).where(eq(schema.session.userId, created.userId));
              await tx.delete(schema.account).where(eq(schema.account.userId, created.userId));
            });
            log("auth", "Claimed password-era account with Google sign-in");
          },
        },
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
    plugins: [
      username(),
      {
        id: "google-only",
        async onRequest(request) {
          // disabledPaths matches exact paths; also close old token-specific reset links.
          if (new URL(request.url).pathname.startsWith("/api/auth/reset-password/"))
            return { response: new Response("Not Found", { status: 404 }) };
        },
      },
      ...(config.MOVIEFINDER_OIDC_ISSUER ? [authRelay(config)] : []),
    ],
    advanced: {
      cookiePrefix: authCookiePrefix(config),
      useSecureCookies: config.NODE_ENV === "production",
      database: { generateId: () => crypto.randomUUID() },
    },
    rateLimit: { enabled: config.NODE_ENV !== "test", window: 60, max: 60 },
  });
  return { ...auth, handler: withRelayStateCookies(auth.handler, config) };
}
export type Auth = ReturnType<typeof createAuth>;
