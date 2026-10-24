import { afterEach, expect, it } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLocalAuthRelay } from "../../scripts/local-auth-relay";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function fixture(overrides: Record<string, string> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "moviefinder-relay-"));
  directories.push(directory);
  await mkdir(join(directory, ".local"));
  await writeFile(
    join(directory, ".local/auth-relay.json"),
    JSON.stringify({
      issuer: "https://auth-dev.chrisvouga.dev/realms/projects-dev",
      clientId: "app-12345678-1234-1234-1234-123456789abc",
      callbackURL: "http://localhost:43117/api/auth/callback/auth-relay",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      ...overrides,
    }),
  );
  return directory;
}
it("restores public registration settings and the exact registered port", async () => {
  const directory = await fixture();
  expect(await readLocalAuthRelay(directory)).toMatchObject({
    port: 43117,
    origin: "http://localhost:43117",
  });
});
it("allows development without a saved registration", async () => {
  expect(await readLocalAuthRelay(join(tmpdir(), crypto.randomUUID()))).toBeUndefined();
});
it("refuses expired registrations and callbacks outside the local application", async () => {
  await expect(
    readLocalAuthRelay(await fixture({ expiresAt: "2020-01-01T00:00:00.000Z" })),
  ).rejects.toThrow("expired");
  await expect(
    readLocalAuthRelay(
      await fixture({ callbackURL: "https://another.example/api/auth/callback/auth-relay" }),
    ),
  ).rejects.toThrow("exact localhost callback");
  await expect(
    readLocalAuthRelay(await fixture({ issuer: "https://auth.chrisvouga.dev/realms/projects" })),
  ).rejects.toThrow("Invalid local auth relay settings");
});
