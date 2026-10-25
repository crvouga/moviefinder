import { startGoogle, googleSignIn, type GoogleTestProvider } from "../fixtures/google";
import { it, expect } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { openLocalDatabase, migrateLocalDatabase } from "../../scripts/local-database";
import { createDatabase } from "../../src/server/db";
import { assertDatabaseReady } from "../../src/server/db/readiness";
import { createApplication } from "../../src/server/app";
import { readConfig } from "../../src/server/config";
import { fixtureUpstream } from "../fixtures/catalog";

it("creates a migrated embedded database, persists registration across restarts, and stops only owned servers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moviefinder-embedded-"));
  let first: Awaited<ReturnType<typeof openLocalDatabase>> | undefined;
  let google: GoogleTestProvider | undefined;
  let second: Awaited<ReturnType<typeof openLocalDatabase>> | undefined;
  try {
    first = await openLocalDatabase(directory);
    await migrateLocalDatabase(first.url);
    const { db, pool } = createDatabase(first.url);
    google = await startGoogle("http://localhost:5173");
    const service = createApplication(
      db,
      readConfig({
        ...google.config,
        DATABASE_URL: first.url,
        BETTER_AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID(),
        NODE_ENV: "test",
      }),
      fixtureUpstream,
    );
    let userId: string;
    try {
      await assertDatabaseReady(db);
      const result = await googleSignIn(service, google, "http://localhost:5173", {
        id: "embedded",
        email: "embedded@example.test",
        name: "Persistent local user",
      });
      userId = result.id;
      const attached = await openLocalDatabase(directory);
      expect(attached.url === first.url).toBe(true);
      await attached.stop();
      await assertDatabaseReady(db);
    } finally {
      service.stop();
      await pool.end();
    }
    await first.stop();
    const stopped = new pg.Client({ connectionString: first.url, connectionTimeoutMillis: 1000 });
    try {
      await expect(stopped.connect()).rejects.toThrow();
    } finally {
      await stopped.end();
    }
    second = await openLocalDatabase(directory);
    await migrateLocalDatabase(second.url);
    await migrateLocalDatabase(second.url, "drift");
    const client = new pg.Client({ connectionString: second.url });
    try {
      await client.connect();
      const result = await client.query('select id from moviefinder."user" where email=$1', [
        "embedded@example.test",
      ]);
      expect(result.rows[0].id).toBe(userId);
      const scratch = await client.query(
        "select datname from pg_database where datname like 'moviefinder_atlas_%'",
      );
      expect(scratch.rows).toHaveLength(0);
    } finally {
      await client.end();
    }
    await expect(migrateLocalDatabase("postgres://invalid@example.invalid/shared")).rejects.toThrow(
      "embedded loopback",
    );
  } finally {
    await google?.close();
    await second?.stop();
    await first?.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
