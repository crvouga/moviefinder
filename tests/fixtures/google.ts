import { createServer } from "@crvouga/mockingbird-service-oauth/server";
import type { Account } from "@crvouga/mockingbird-service-oauth";
import type { createApplication } from "../../src/server/app";

// Test-only Google wire profile. Public PKCE clients use the application's real callback.
export async function startGoogle(origin: string, additionalOrigins: string[] = []) {
  const clientId = "moviefinder-google-test";
  const server = await createServer({
    host: "127.0.0.1",
    port: 0,
    provider: "google",
    accounts: [],
    clients: [
      {
        id: clientId,
        name: "MovieFinder test",
        redirectUris: [origin, ...additionalOrigins].map(
          (value) => `${value}/api/auth/callback/auth-relay`,
        ),
      },
    ],
  });
  return {
    ...server,
    config: { MOVIEFINDER_OIDC_ISSUER: server.url, MOVIEFINDER_OIDC_CLIENT_ID: clientId },
  };
}
export type GoogleTestProvider = Awaited<ReturnType<typeof startGoogle>>;

export async function googleCallback(
  service: Pick<ReturnType<typeof createApplication>, "app">,
  google: GoogleTestProvider,
  origin: string,
  identity: Account,
) {
  google.runtime.instance().seedAccount({ emailVerified: true, ...identity });
  const started = await service.app.request("/api/auth/sign-in/social", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "auth-relay", callbackURL: "/", disableRedirect: true }),
  });
  if (!started.ok) throw new Error("Could not start fixture Google sign-in");
  const { url } = await started.json();
  const authorize = await fetch(url, { redirect: "manual" });
  const interaction = new URL(authorize.headers.get("location") ?? "", google.url);
  const transaction =
    interaction.searchParams.get("transaction") ??
    (await authorize.text()).match(/name="transaction" value="([^"]+)"/)?.[1];
  if (!transaction) throw new Error("Google fixture did not present account selection");
  let consent = await fetch(`${google.url}/interaction`, {
    method: "POST",
    redirect: "manual",
    body: new URLSearchParams({ transaction, action: "select", account: identity.id }),
  });
  if (!consent.headers.has("location"))
    consent = await fetch(`${google.url}/interaction`, {
      method: "POST",
      redirect: "manual",
      body: new URLSearchParams({ transaction, action: "allow" }),
    });
  const destination = consent.headers.get("location");
  if (!destination || !destination.startsWith(`${origin}/api/auth/callback/auth-relay?`))
    throw new Error("Google fixture did not return the registered callback");
  return service.app.request(destination, {
    headers: {
      Cookie: started.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
    },
  });
}

export async function googleSignIn(...args: Parameters<typeof googleCallback>) {
  const callback = await googleCallback(...args);
  const service = args[0];
  const cookie = callback.headers
    .getSetCookie()
    .filter((c) => c.includes(".session_token="))
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!cookie) throw new Error("Fixture Google sign-in did not establish a session");
  const session = await (
    await service.app.request("/api/auth/get-session", { headers: { Cookie: cookie } })
  ).json();
  return { id: session.user.id as string, cookie };
}
