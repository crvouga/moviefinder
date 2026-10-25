import { createAuth } from "./auth";
import { applicationOrigins, type Config } from "./config";
import type { Database } from "./db";

export function createAuthForOrigins(db: Database, config: Config) {
  const instances = applicationOrigins(config).map((origin) => ({
    origin,
    auth: createAuth(db, { ...config, MOVIEFINDER_ORIGIN: origin }),
  }));
  const byHost = new Map(instances.map((instance) => [new URL(instance.origin).host, instance]));
  return (request: Request) => {
    // The configured HTTPS origin remains authoritative behind Railway's TLS
    // termination. Never derive callbacks from forwarded headers or Origin.
    // Single-origin local proxies and existing test requests retain their behavior.
    if (instances.length === 1) return instances[0]!;
    return byHost.get(new URL(request.url).host);
  };
}

export type AuthForRequest = ReturnType<typeof createAuthForOrigins>;
