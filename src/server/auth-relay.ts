import { createHash } from "node:crypto";
import {
  createAuthorizationURL,
  getOAuth2Tokens,
  type BetterAuthPlugin,
  type OAuthProvider,
} from "better-auth";
import { createRemoteJWKSet, customFetch, jwtVerify, type JWTPayload } from "jose";
import { z } from "zod";
import type { Config } from "./config";
import { createAuthMiddleware } from "better-auth/api";

export const relayProviderId = "auth-relay";
export const relayCallbackPath = `/api/auth/callback/${relayProviderId}`;

export function authCookiePrefix(config: Config) {
  // Ports share cookies. The origin separates concurrent instances, including worktrees.
  const instance = createHash("sha256")
    .update(config.MOVIEFINDER_ORIGIN)
    .digest("hex")
    .slice(0, 16);
  return `moviefinder-${instance}`;
}

const discoverySchema = z.object({
  issuer: z.string(),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  jwks_uri: z.url(),
  response_types_supported: z.array(z.string()),
  code_challenge_methods_supported: z.array(z.string()),
  id_token_signing_alg_values_supported: z.array(z.string()),
});
const tokenSchema = z.object({
  access_token: z.string().min(1),
  id_token: z.string().min(1),
  token_type: z.literal("Bearer"),
  expires_in: z.number().positive().optional(),
  scope: z.string().optional(),
});

export function createRelayProvider(config: Config): OAuthProvider<JWTPayload> {
  const issuer = config.MOVIEFINDER_OIDC_ISSUER!;
  const clientId = config.MOVIEFINDER_OIDC_CLIENT_ID!;
  const redirectURI = `${config.MOVIEFINDER_ORIGIN}${relayCallbackPath}`;
  let cached:
    | {
        metadata: z.infer<typeof discoverySchema>;
        expires: number;
        keys: ReturnType<typeof createRemoteJWKSet>;
      }
    | undefined;
  let pending: Promise<NonNullable<typeof cached>> | undefined;
  async function discover() {
    if (cached && cached.expires > Date.now()) return cached;
    pending ??= (async () => {
      const res = await fetch(`${issuer}/.well-known/openid-configuration`, {
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error("Auth relay discovery unavailable");
      const metadata = discoverySchema.parse(await res.json());
      if (
        metadata.issuer !== issuer ||
        !metadata.response_types_supported.includes("code") ||
        !metadata.code_challenge_methods_supported.includes("S256") ||
        !metadata.id_token_signing_alg_values_supported.includes("RS256")
      )
        throw new Error("Auth relay discovery does not match the required OIDC profile");
      for (const endpoint of [
        metadata.authorization_endpoint,
        metadata.token_endpoint,
        metadata.jwks_uri,
      ]) {
        const url = new URL(endpoint);
        if (url.origin !== new URL(issuer).origin || url.username || url.password || url.hash)
          throw new Error("Auth relay discovery contains an untrusted endpoint");
      }
      cached = {
        metadata,
        expires: Date.now() + 300000,
        keys:
          cached?.metadata.jwks_uri === metadata.jwks_uri
            ? cached.keys
            : createRemoteJWKSet(new URL(metadata.jwks_uri), {
                cacheMaxAge: 300000,
                cooldownDuration: 30000,
                timeoutDuration: 10000,
                [customFetch]: (url, init) => fetch(url, { ...init, redirect: "error" }),
              }),
      };
      return cached;
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  }
  return {
    id: relayProviderId,
    name: "Google via shared auth relay",
    issuer,
    requiresIdTokenNonce: true,
    options: { disableIdTokenSignIn: true },
    accountSubject: ({ profile }) => JSON.stringify([issuer, profile.sub]),
    async createAuthorizationURL(data) {
      const { metadata } = await discover();
      if (!data.idTokenNonce || !data.codeVerifier || data.redirectURI !== redirectURI)
        throw new Error("Invalid auth relay transaction");
      return createAuthorizationURL({
        id: relayProviderId,
        options: { clientId },
        authorizationEndpoint: metadata.authorization_endpoint,
        state: data.state,
        codeVerifier: data.codeVerifier,
        nonce: data.idTokenNonce,
        redirectURI,
        responseType: "code",
        responseMode: "query",
        scopes: ["openid", "email", "profile"],
        additionalParams: { kc_idp_hint: "google" },
      });
    },
    async validateAuthorizationCode(data) {
      if (!data.codeVerifier || data.redirectURI !== redirectURI)
        throw new Error("Invalid auth relay transaction");
      const { metadata } = await discover();
      // Public client: no Authorization header or client secret. Never retry a one-time code.
      const response = await fetch(metadata.token_endpoint, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          code: data.code,
          code_verifier: data.codeVerifier,
          redirect_uri: redirectURI,
        }),
      });
      if (!response.ok) throw new Error("Auth relay code exchange failed");
      return getOAuth2Tokens(tokenSchema.parse(await response.json()));
    },
    async getUserInfo(tokens) {
      if (!tokens.idToken || !tokens.expectedIdTokenNonce) return null;
      try {
        const { keys } = await discover();
        const { payload } = await jwtVerify(tokens.idToken, keys, {
          issuer,
          audience: clientId,
          algorithms: ["RS256"],
          requiredClaims: ["sub", "exp", "iat", "nonce", "email", "email_verified"],
          maxTokenAge: "10m",
        });
        if (
          payload.nonce !== tokens.expectedIdTokenNonce ||
          typeof payload.sub !== "string" ||
          !payload.sub.trim() ||
          payload.email_verified !== true ||
          typeof payload.email !== "string" ||
          !z.email().safeParse(payload.email).success ||
          (payload.azp !== undefined && payload.azp !== clientId) ||
          (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)
        )
          return null;
        return {
          data: payload,
          user: {
            email: payload.email,
            emailVerified: true,
            name: typeof payload.name === "string" ? payload.name : "MovieFinder member",
            image: typeof payload.picture === "string" ? payload.picture : undefined,
          },
        };
      } catch {
        return null;
      }
    },
  };
}

export function authRelay(config: Config): BetterAuthPlugin {
  const binding = createHash("sha256")
    .update(
      JSON.stringify([
        config.MOVIEFINDER_OIDC_ISSUER,
        config.MOVIEFINDER_OIDC_CLIENT_ID,
        config.MOVIEFINDER_ORIGIN,
      ]),
    )
    .digest("hex");
  const key = (identifier: string) =>
    identifier.startsWith("auth-state:") ? `${binding}:${identifier}` : identifier;
  return {
    id: "moviefinder-auth-relay",
    init(ctx) {
      return {
        context: {
          socialProviders: [createRelayProvider(config), ...ctx.socialProviders],
        },
      };
    },
    hooks: {
      before: [
        {
          matcher: () => true,
          handler: createAuthMiddleware(async (ctx) => {
            // Better Auth rebuilds its internal adapter after plugin initialization. Apply the
            // state binding/atomic consumption on the request context after that rebuild.
            const adapter = ctx.context.internalAdapter;
            return {
              context: {
                context: {
                  internalAdapter: {
                    ...adapter,
                    createVerificationValue: (
                      value: Parameters<typeof adapter.createVerificationValue>[0],
                    ) =>
                      adapter.createVerificationValue({
                        ...value,
                        identifier: key(value.identifier),
                      }),
                    findVerificationValue: (identifier: string) =>
                      identifier.startsWith("auth-state:")
                        ? adapter.consumeVerificationValue(key(identifier))
                        : adapter.findVerificationValue(identifier),
                    deleteVerificationByIdentifier: (identifier: string) =>
                      adapter.deleteVerificationByIdentifier(key(identifier)),
                  },
                },
              },
            };
          }),
        },
      ],
    },
  };
}

// Better Auth uses one state cookie by default. Give each redirect its own signed cookie so
// starting login in another tab cannot overwrite it. The library still validates its signature.
export function withRelayStateCookies(
  handler: (request: Request) => Promise<Response>,
  config: Config,
) {
  const cookieName = `${config.NODE_ENV === "production" ? "__Secure-" : ""}${authCookiePrefix(config)}.state`;
  return async (request: Request) => {
    const url = new URL(request.url);
    const state = url.pathname === relayCallbackPath ? url.searchParams.get("state") : null;
    const validState = state && /^[a-zA-Z0-9_-]{32}$/.test(state) ? state : null;
    if (url.pathname === relayCallbackPath) {
      const cookies = (request.headers.get("cookie") ?? "").split(/;\s*/);
      const flowCookie = cookies.find(
        (cookie) => validState && cookie.startsWith(`${cookieName}.${validState}=`),
      );
      const headers = new Headers(request.headers);
      headers.set(
        "cookie",
        [
          ...cookies.filter((cookie) => !cookie.startsWith(`${cookieName}=`)),
          ...(flowCookie ? [`${cookieName}=${flowCookie.slice(flowCookie.indexOf("=") + 1)}`] : []),
        ].join("; "),
      );
      request = new Request(request, { headers });
    }
    const response = await handler(request);
    const headers = new Headers(response.headers);
    headers.delete("set-cookie");
    for (const cookie of response.headers.getSetCookie()) {
      if (!cookie.startsWith(`${cookieName}=`)) {
        headers.append("set-cookie", cookie);
        continue;
      }
      const signedState = decodeURIComponent(
        cookie.slice(cookie.indexOf("=") + 1).split(";")[0]!,
      ).split(".")[0];
      const flow = validState ?? signedState;
      if (flow && /^[a-zA-Z0-9_-]{32}$/.test(flow))
        headers.append(
          "set-cookie",
          cookie
            .replace(`${cookieName}=`, `${cookieName}.${flow}=`)
            .replace(/Max-Age=300\b/i, "Max-Age=600"),
        );
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
