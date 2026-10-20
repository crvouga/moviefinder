import { z } from "zod";
export const configSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  MOVIEFINDER_ORIGIN: z.url().default("http://localhost:5173"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  MOVIEFINDER_TELEMETRY_DIR: z.string().optional(),
  TMDB_API_READ_ACCESS_TOKEN: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  MOVIEFINDER_GOOGLE_CLIENT_ID: z.string().optional(),
  MOVIEFINDER_GOOGLE_CLIENT_SECRET: z.string().optional(),
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
  return result.data;
}
