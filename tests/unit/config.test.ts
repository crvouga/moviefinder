import { expect, it } from "vite-plus/test";

import { readConfig } from "../../src/server/config";
import { authCookiePrefix } from "../../src/server/auth-relay";
const authEnv = {
  DATABASE_URL: "test",
  BETTER_AUTH_SECRET: "test-only-auth-secret-at-least-32-characters",
};
it("requires complete relay configuration and isolates production from nonproduction", () => {
  expect(() => readConfig({ ...authEnv, MOVIEFINDER_OIDC_CLIENT_ID: "app-test" })).toThrow(
    "must be set together",
  );
  expect(() =>
    readConfig({
      ...authEnv,
      MOVIEFINDER_OIDC_ISSUER: "https://auth-dev.chrisvouga.dev/realms/projects-dev",
    }),
  ).toThrow("must be set together");
  expect(() =>
    readConfig({
      ...authEnv,
      MOVIEFINDER_OIDC_CLIENT_ID: "app-test",
      MOVIEFINDER_OIDC_ISSUER: "http://untrusted.example/realm",
    }),
  ).toThrow("exact HTTPS issuer");
  expect(() =>
    readConfig({
      ...authEnv,
      NODE_ENV: "production",
      MOVIEFINDER_ORIGIN: "https://moviefinder.chrisvouga.dev",
      MOVIEFINDER_OIDC_CLIENT_ID: "app-test",
      MOVIEFINDER_OIDC_ISSUER: "https://auth-dev.chrisvouga.dev/realms/projects-dev",
    }),
  ).toThrow("production shared auth relay");
  expect(() =>
    readConfig({
      ...authEnv,
      MOVIEFINDER_OIDC_CLIENT_ID: "app-test",
      MOVIEFINDER_OIDC_ISSUER: "https://auth.chrisvouga.dev/realms/projects",
    }),
  ).toThrow("nonproduction shared auth relay");
});
it("namespaces cookies by application and exact instance origin", () => {
  const a = readConfig({ ...authEnv, MOVIEFINDER_ORIGIN: "http://localhost:5173" });
  const b = readConfig({ ...authEnv, MOVIEFINDER_ORIGIN: "http://localhost:8080" });
  expect(authCookiePrefix(a)).toMatch(/^moviefinder-/);
  expect(authCookiePrefix(a)).not.toBe(authCookiePrefix(b));
  expect(authCookiePrefix(a)).toBe(authCookiePrefix({ ...a }));
});
it("uses the project-owned auth secret while preserving existing local configuration", () => {
  const legacy = "local-development-only-secret-long-enough";
  const project = "project-owned-production-secret-long-enough";
  expect(readConfig({ DATABASE_URL: "test", BETTER_AUTH_SECRET: legacy }).BETTER_AUTH_SECRET).toBe(
    legacy,
  );
  expect(
    readConfig({
      DATABASE_URL: "test",
      BETTER_AUTH_SECRET: legacy,
      MOVIEFINDER_AUTH_SECRET: project,
    }).BETTER_AUTH_SECRET,
  ).toBe(project);
  expect(() =>
    readConfig({
      DATABASE_URL: "test",
      BETTER_AUTH_SECRET: legacy,
      MOVIEFINDER_AUTH_SECRET: "invalid",
    }),
  ).toThrow("Invalid configuration");
});

import { verifyAllocation } from "../../scripts/verify-allocation";
it("requires the merged platform ownership record before production migrations", () => {
  const entry = {
    id: "moviefinder",
    github_repo: "crvouga/moviefinder",
    database_schema: "moviefinder",
    manage_database_schema: true,
  };
  const inventory = (service: typeof entry) => ({ locals: { inventory: { services: [service] } } });
  expect(() => verifyAllocation(inventory(entry))).not.toThrow();
  expect(() => verifyAllocation({})).toThrow("has not approved");
  expect(() =>
    verifyAllocation(inventory({ ...entry, github_repo: "crvouga/moviefinder.app-rust" })),
  ).toThrow("has not approved");
  expect(() => verifyAllocation(inventory({ ...entry, database_schema: "public" }))).toThrow(
    "has not approved",
  );
});
