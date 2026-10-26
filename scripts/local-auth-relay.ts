import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export async function localDevAuth(env: NodeJS.ProcessEnv, directory = process.cwd()) {
  const issuer = env.MOVIEFINDER_OIDC_ISSUER;
  const clientId = env.MOVIEFINDER_OIDC_CLIENT_ID;
  if (!!issuer !== !!clientId)
    throw new Error("MOVIEFINDER_OIDC_ISSUER and MOVIEFINDER_OIDC_CLIENT_ID must be set together");
  if (issuer && clientId) {
    if (!env.MOVIEFINDER_WEB_PORT)
      throw new Error(
        "Explicit Google relay settings require MOVIEFINDER_WEB_PORT to match the registered callback",
      );
    return { issuer, clientId, port: Number(env.MOVIEFINDER_WEB_PORT) };
  }
  const relay = await readLocalAuthRelay(directory);
  if (relay && env.MOVIEFINDER_WEB_PORT && Number(env.MOVIEFINDER_WEB_PORT) !== relay.port)
    throw new Error(
      "MOVIEFINDER_WEB_PORT differs from the registered Google callback; update the relay registration first",
    );
  return relay;
}

// Public connection settings returned by the relay API. No credentials belong here.
const settingsSchema = z.object({
  issuer: z.literal("https://auth-dev.chrisvouga.dev/realms/projects-dev"),
  clientId: z.string().regex(/^app-[a-f0-9-]{36}$/),
  callbackURL: z.url(),
  expiresAt: z.iso.datetime(),
});

export async function readLocalAuthRelay(directory = process.cwd()) {
  let source: string;
  try {
    source = await readFile(join(directory, ".local/auth-relay.json"), "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
      return undefined;
    throw new Error("Cannot read local auth relay settings");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("Invalid local auth relay settings");
  }
  const result = settingsSchema.safeParse(parsed);
  if (!result.success) throw new Error("Invalid local auth relay settings");
  const settings = result.data;
  const callback = new URL(settings.callbackURL);
  if (
    callback.protocol !== "http:" ||
    callback.hostname !== "localhost" ||
    !callback.port ||
    callback.pathname !== "/api/auth/callback/auth-relay" ||
    callback.search ||
    callback.hash ||
    callback.username ||
    callback.password
  )
    throw new Error("Local auth relay settings require an exact localhost callback");
  if (Date.parse(settings.expiresAt) <= Date.now())
    throw new Error(
      "MovieFinder's local Google registration expired; renew it through the auth relay API",
    );
  return { ...settings, port: Number(callback.port), origin: callback.origin };
}
