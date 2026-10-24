import { z } from "zod";
export const configSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  MOVIEFINDER_ORIGIN: z.url().default("http://localhost:5173"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  MOVIEFINDER_TELEMETRY_DIR: z.string().optional(),
  TMDB_API_READ_ACCESS_TOKEN: z.string().optional(),
  MOVIEFINDER_OIDC_ISSUER: z.url().optional(),
  MOVIEFINDER_OIDC_CLIENT_ID: z.string().trim().min(1).optional(),
});
export type Config = z.infer<typeof configSchema>;
export function readConfig(env: Record<string, string | undefined>) {
  const result = configSchema.safeParse({
    ...env,
    BETTER_AUTH_SECRET: env.MOVIEFINDER_AUTH_SECRET ?? env.BETTER_AUTH_SECRET,
  });
  if (!result.success)
    throw new Error(
      `Invalid configuration: ${result.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  if (result.data.NODE_ENV === "production" && !env.MOVIEFINDER_ORIGIN)
    throw new Error("MOVIEFINDER_ORIGIN is required in production");
  if (result.data.NODE_ENV === "production" && result.data.MOVIEFINDER_TELEMETRY_DIR)
    throw new Error("MOVIEFINDER_TELEMETRY_DIR is for local development only");
  const { MOVIEFINDER_OIDC_ISSUER: issuer, MOVIEFINDER_OIDC_CLIENT_ID: clientId } = result.data;
  if (!!issuer !== !!clientId)
    throw new Error("MOVIEFINDER_OIDC_ISSUER and MOVIEFINDER_OIDC_CLIENT_ID must be set together");
  if (issuer) {
    const url = new URL(issuer);
    if (new URL(result.data.MOVIEFINDER_ORIGIN).origin !== result.data.MOVIEFINDER_ORIGIN)
      throw new Error("MOVIEFINDER_ORIGIN must be an exact origin for relay callbacks");
    const localTest =
      result.data.NODE_ENV === "test" &&
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname);
    if (
      (!localTest && url.protocol !== "https:") ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      issuer.endsWith("/")
    )
      throw new Error(
        "MOVIEFINDER_OIDC_ISSUER must be an exact HTTPS issuer without a trailing slash",
      );
    if (
      result.data.NODE_ENV === "production" &&
      issuer !== "https://auth.chrisvouga.dev/realms/projects"
    )
      throw new Error("Production requires the production shared auth relay issuer");
    if (
      result.data.NODE_ENV === "development" &&
      issuer !== "https://auth-dev.chrisvouga.dev/realms/projects-dev"
    )
      throw new Error("Development requires the nonproduction shared auth relay issuer");
  }
  return result.data;
}
