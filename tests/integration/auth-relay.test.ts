import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../../src/server/db";
import { createApplication } from "../../src/server/app";
import { readConfig } from "../../src/server/config";
import { account, user, verification } from "../../src/server/db/schema";
import { fixtureUpstream } from "../fixtures/catalog";

const databaseURL = process.env.TEST_DATABASE_URL;
if (
  !databaseURL ||
  !["localhost", "127.0.0.1"].includes(new URL(databaseURL).hostname) ||
  !new URL(databaseURL).pathname.endsWith("_test")
)
  throw new Error("Disposable loopback TEST_DATABASE_URL required");
const { db, pool } = createDatabase(databaseURL);
const origin = "http://localhost:43117";
const clientId = "app-moviefinder-fixture";
const secret = "isolated-auth-relay-tests-only-at-least-32-characters";
const codes = new Map<
  string,
  { nonce: string; challenge: string; claims: JWTPayload; redirectURI: string }
>();
let server: Server;
let issuer: string;
let service: ReturnType<typeof createApplication>;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let untrustedKeys: Awaited<ReturnType<typeof generateKeyPair>>;
let exchanges = 0;
let unavailable = false;

beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  untrustedKeys = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: "fixture-signing-key",
    alg: "RS256",
    use: "sig",
  };
  server = createServer((req, res) => {
    void (async () => {
      res.setHeader("Content-Type", "application/json");
      if (unavailable) {
        res.writeHead(503).end("{}");
        return;
      }
      if (req.url === "/realms/test/.well-known/openid-configuration") {
        res.end(
          JSON.stringify({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            jwks_uri: `${issuer}/keys`,
            response_types_supported: ["code"],
            code_challenge_methods_supported: ["S256"],
            id_token_signing_alg_values_supported: ["RS256"],
          }),
        );
      } else if (req.url === "/realms/test/keys") res.end(JSON.stringify({ keys: [jwk] }));
      else if (req.url === "/realms/test/token") {
        exchanges++;
        const chunks = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = new URLSearchParams(Buffer.concat(chunks).toString());
        const code = body.get("code")!;
        const flow = codes.get(code);
        codes.delete(code);
        const challenge = createHash("sha256")
          .update(body.get("code_verifier") ?? "")
          .digest("base64url");
        if (
          !flow ||
          challenge !== flow.challenge ||
          body.get("client_id") !== clientId ||
          body.get("redirect_uri") !== flow.redirectURI ||
          body.has("client_secret") ||
          req.headers.authorization
        ) {
          res.writeHead(400).end("{}");
          return;
        }
        const idToken = await new SignJWT({
          nonce: flow.nonce,
          email: `relay-${crypto.randomUUID()}@example.test`,
          email_verified: true,
          name: "Relay Member",
          ...flow.claims,
        })
          .setProtectedHeader({ alg: "RS256", kid: "fixture-signing-key" })
          .setIssuer(typeof flow.claims.iss === "string" ? flow.claims.iss : issuer)
          .setAudience(flow.claims.aud ?? clientId)
          .setSubject(flow.claims.sub ?? crypto.randomUUID())
          .setIssuedAt()
          .setExpirationTime(flow.claims.exp ?? "5m")
          .sign(flow.claims.fixtureWrongSignature ? untrustedKeys.privateKey : keys.privateKey);
        res.end(
          JSON.stringify({
            access_token: "fixture-access-token",
            id_token: idToken,
            token_type: "Bearer",
            expires_in: 300,
            scope: "openid email profile",
          }),
        );
      } else res.writeHead(404).end("{}");
    })().catch(() => {
      res.writeHead(500).end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No fixture port");
  issuer = `http://127.0.0.1:${address.port}/realms/test`;
  service = makeService();
});
function makeService(other: Record<string, string> = {}) {
  return createApplication(
    db,
    readConfig({
      DATABASE_URL: databaseURL,
      BETTER_AUTH_SECRET: secret,
      MOVIEFINDER_ORIGIN: origin,
      MOVIEFINDER_OIDC_ISSUER: issuer,
      MOVIEFINDER_OIDC_CLIENT_ID: clientId,
      NODE_ENV: "test",
      ...other,
    }),
    fixtureUpstream,
  );
}
afterAll(async () => {
  service?.stop();
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await pool.end();
});
async function begin(claims: JWTPayload = {}, target = service, targetOrigin = origin) {
  const response = await target.app.request(`${targetOrigin}/api/auth/sign-in/social`, {
    method: "POST",
    headers: { Origin: targetOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "auth-relay",
      callbackURL: "/lists/fixture?tab=items",
      errorCallbackURL: `${targetOrigin}/auth?socialError=1`,
      disableRedirect: true,
    }),
  });
  expect(response.status).toBe(200);
  const authorize = new URL((await response.json()).url);
  const state = authorize.searchParams.get("state")!;
  const code = crypto.randomUUID();
  codes.set(code, {
    nonce: authorize.searchParams.get("nonce")!,
    challenge: authorize.searchParams.get("code_challenge")!,
    claims,
    redirectURI: authorize.searchParams.get("redirect_uri")!,
  });
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  return { authorize, state, code, cookie, origin: targetOrigin };
}
type Flow = Awaited<ReturnType<typeof begin>>;
function callback(flow: Flow, cookie = flow.cookie, target = service) {
  return target.app.request(
    `${flow.origin}/api/auth/callback/auth-relay?state=${flow.state}&code=${flow.code}`,
    {
      headers: { Cookie: cookie },
    },
  );
}
function sessionCookie(response: Response) {
  return response.headers
    .getSetCookie()
    .filter((value) => value.includes(".session_token="))
    .map((value) => value.split(";")[0])
    .join("; ");
}
describe("shared relay public OIDC code flow", () => {
  it("supports both registered domains with independent sessions and exact callback/CSRF boundaries", async () => {
    const extra = "http://localhost:43118";
    const multi = makeService({ MOVIEFINDER_ADDITIONAL_ORIGINS: extra });
    const previous = sessionCookie(await callback(await begin()));
    try {
      expect(
        (await multi.app.request(`${origin}/api/state`, { headers: { Cookie: previous } })).status,
      ).toBe(200);
      const a = await begin({}, multi, origin),
        b = await begin({}, multi, extra);
      expect(a.authorize.searchParams.get("redirect_uri")).toBe(
        `${origin}/api/auth/callback/auth-relay`,
      );
      expect(b.authorize.searchParams.get("redirect_uri")).toBe(
        `${extra}/api/auth/callback/auth-relay`,
      );
      expect(a.cookie.split("=")[0]).not.toBe(b.cookie.split("=")[0]);
      const primaryCookie = sessionCookie(await callback(a, a.cookie, multi));
      const extraCookie = sessionCookie(await callback(b, b.cookie, multi));
      for (const [host, cookie, other] of [
        [origin, primaryCookie, extraCookie],
        [extra, extraCookie, primaryCookie],
      ]) {
        expect(Boolean(cookie)).toBe(true);
        expect(
          (await multi.app.request(`${host}/api/state`, { headers: { Cookie: cookie! } })).status,
        ).toBe(200);
        expect(
          (await multi.app.request(`${host}/api/state`, { headers: { Cookie: other! } })).status,
        ).toBe(401);
        expect(
          (
            await multi.app.request(`${host}/api/command`, {
              method: "POST",
              headers: {
                Cookie: cookie!,
                Origin: host === origin ? extra : origin,
                "Content-Type": "application/json",
              },
              body: "{}",
            })
          ).status,
        ).toBe(403);
        // Matching origin reaches command validation; it is not rejected by CSRF.
        expect(
          (
            await multi.app.request(`${host}/api/command`, {
              method: "POST",
              headers: { Cookie: cookie!, Origin: host!, "Content-Type": "application/json" },
              body: "{}",
            })
          ).status,
        ).toBe(400);
      }
      const cross = await begin({}, multi, extra);
      const before = exchanges;
      const wrongHost = await multi.app.request(
        `${origin}/api/auth/callback/auth-relay?state=${cross.state}&code=${cross.code}`,
        { headers: { Cookie: cross.cookie } },
      );
      expect(sessionCookie(wrongHost)).toBe("");
      expect(exchanges).toBe(before);
      expect(
        (
          await multi.app.request("https://unregistered.example/api/auth/sign-in/social", {
            method: "POST",
            headers: { Origin: extra, "X-Forwarded-Host": new URL(extra).host },
            body: "{}",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await multi.app.request(`${extra}/api/auth/sign-out`, {
            method: "POST",
            headers: { Cookie: extraCookie, Origin: extra, "Content-Type": "application/json" },
            body: "{}",
          })
        ).status,
      ).toBe(200);
      expect(
        (await multi.app.request(`${extra}/api/state`, { headers: { Cookie: extraCookie } }))
          .status,
      ).toBe(401);
      expect(
        (await multi.app.request(`${origin}/api/state`, { headers: { Cookie: primaryCookie } }))
          .status,
      ).toBe(200);
    } finally {
      multi.stop();
    }
  });
  it("advertises Google without credentials and establishes a persisted application session", async () => {
    expect(await (await service.app.request("/api/auth-options")).json()).toMatchObject({
      google: true,
    });
    const subject = crypto.randomUUID();
    const flow = await begin({ sub: subject });
    expect(Object.fromEntries(flow.authorize.searchParams)).toMatchObject({
      client_id: clientId,
      redirect_uri: `${origin}/api/auth/callback/auth-relay`,
      response_type: "code",
      response_mode: "query",
      scope: "openid email profile",
      code_challenge_method: "S256",
      kc_idp_hint: "google",
    });
    expect(flow.authorize.searchParams.get("nonce")).toBeTruthy();
    expect(flow.cookie.includes(`.state.${flow.state}=`)).toBe(true);
    const response = await callback(flow);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/lists/fixture?tab=items");
    const cookie = sessionCookie(response);
    expect(Boolean(cookie)).toBe(true);
    expect((await service.app.request("/api/state", { headers: { Cookie: cookie } })).status).toBe(
      200,
    );
    const [row] = await db
      .select()
      .from(account)
      .where(eq(account.accountId, JSON.stringify([issuer, subject])));
    expect(row?.providerId).toBe("auth-relay");
    expect(row?.accessToken).not.toBe("fixture-access-token");
    // Session restoration after a server restart must not depend on the broker being reachable.
    const restarted = makeService();
    unavailable = true;
    try {
      expect(
        (await restarted.app.request("/api/state", { headers: { Cookie: cookie } })).status,
      ).toBe(200);
    } finally {
      unavailable = false;
      restarted.stop();
    }
  });
  it("keeps concurrent tabs independent and consumes replayed state only once", async () => {
    const a = await begin(),
      b = await begin();
    expect(a.state).not.toBe(b.state);
    const browserCookies = `${a.cookie}; ${b.cookie}`;
    expect(Boolean(sessionCookie(await callback(b, browserCookies)))).toBe(true);
    const before = exchanges;
    const attempts = await Promise.all([callback(a, browserCookies), callback(a, browserCookies)]);
    expect(attempts.filter((response) => sessionCookie(response))).toHaveLength(1);
    expect(exchanges - before).toBe(1);
    expect(Boolean(sessionCookie(await callback(a, browserCookies)))).toBe(false);
  });
  it("rejects missing/wrong browser cookies, expired state and cross-instance callbacks before exchange", async () => {
    const before = exchanges;
    const missing = await begin();
    expect(Boolean(sessionCookie(await callback(missing, "")))).toBe(false);
    const a = await begin(),
      b = await begin();
    expect(Boolean(sessionCookie(await callback(a, b.cookie)))).toBe(false);
    const expired = await begin();
    const expiredRows = await db
      .update(verification)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(sql`${verification.value}::jsonb ->> 'oauthState' = ${expired.state}`)
      .returning({ id: verification.id });
    expect(expiredRows.length).toBe(1);
    expect(Boolean(sessionCookie(await callback(expired)))).toBe(false);
    const other = makeService({ MOVIEFINDER_ORIGIN: "http://localhost:43118" });
    const cross = await begin();
    try {
      const response = await other.app.request(
        `/api/auth/callback/auth-relay?state=${cross.state}&code=${cross.code}`,
        {
          headers: { Cookie: cross.cookie },
        },
      );
      expect(Boolean(sessionCookie(response))).toBe(false);
    } finally {
      other.stop();
    }
    const changedClient = makeService({ MOVIEFINDER_OIDC_CLIENT_ID: "app-another-instance" });
    const wrongClientFlow = await begin();
    try {
      const response = await changedClient.app.request(
        `/api/auth/callback/auth-relay?state=${wrongClientFlow.state}&code=${wrongClientFlow.code}`,
        {
          headers: { Cookie: wrongClientFlow.cookie },
        },
      );
      expect(Boolean(sessionCookie(response))).toBe(false);
    } finally {
      changedClient.stop();
    }
    expect(exchanges).toBe(before);
  });
  it.each([
    { nonce: "wrong" },
    { iss: "https://wrong.example/realm" },
    { aud: "another-client" },
    { exp: 1 },
    { email_verified: false },
    { azp: "another-client" },
    { fixtureWrongSignature: true },
  ])("rejects invalid signed ID-token claims %j", async (claims) => {
    const response = await callback(await begin(claims));
    expect(Boolean(sessionCookie(response))).toBe(false);
    expect(response.headers.get("location")).toContain("socialError=1");
  });
  it("does not link an existing email account automatically", async () => {
    const email = `relay-existing-${crypto.randomUUID()}@example.test`;
    // Existing password-era records must not be silently merged into a Google identity.
    const existingId = crypto.randomUUID();
    await db.insert(user).values({ id: existingId, email, name: "Existing member" });
    await db.insert(account).values({
      id: crypto.randomUUID(),
      accountId: existingId,
      userId: existingId,
      providerId: "credential",
    });
    expect(Boolean(sessionCookie(await callback(await begin({ email }))))).toBe(false);
    const [existing] = await db.select().from(user).where(eq(user.email, email));
    const accounts = await db.select().from(account).where(eq(account.userId, existing!.id));
    expect(accounts.map((row) => row.providerId)).toEqual(["credential"]);
  });
  it("rejects submitted ID tokens outside a bound authorization-code transaction", async () => {
    const response = await service.app.request("/api/auth/sign-in/social", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "auth-relay",
        idToken: { token: "unsigned.fixture.token" },
      }),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(Boolean(sessionCookie(response))).toBe(false);
  });
  it("never retries failed token exchanges and fails closed during broker outage", async () => {
    const flow = await begin();
    const before = exchanges;
    codes.delete(flow.code);
    expect(Boolean(sessionCookie(await callback(flow)))).toBe(false);
    expect(Boolean(sessionCookie(await callback(flow)))).toBe(false);
    expect(exchanges - before).toBe(1);
    const outage = await begin();
    unavailable = true;
    try {
      expect(Boolean(sessionCookie(await callback(outage)))).toBe(false);
    } finally {
      unavailable = false;
    }
    expect(Boolean(sessionCookie(await callback(outage)))).toBe(false);
  });
});
