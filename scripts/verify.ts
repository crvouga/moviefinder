import { openLocalDatabase } from "./local-database";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "../src/server/db";
import { sql } from "drizzle-orm";
const mode = process.argv[2] ?? "integration";
let embedded: Awaited<ReturnType<typeof openLocalDatabase>> | undefined;
let directory: string | undefined;
let exitCode = 0;
async function run(args: string[], env: Record<string, string | undefined> = process.env) {
  const child = Bun.spawn(args, { stdout: "inherit", stderr: "inherit", env });
  const code = await child.exited;
  if (code !== 0) throw new Error(`${args[0]} failed with exit code ${code}`);
}
try {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    directory = await mkdtemp(join(tmpdir(), "moviefinder-test-"));
    embedded = await openLocalDatabase(directory, "moviefinder_test");
    url = embedded.url;
  }
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || !parsed.pathname.endsWith("_test"))
    throw new Error("Refusing integration tests against a non-disposable database");
  const { db, pool } = createDatabase(url);
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      await db.execute(sql`select 1`);
      ready = true;
      break;
    } catch {
      await Bun.sleep(500);
    }
  }
  if (!ready) throw new Error("Test PostgreSQL did not become ready");
  await db.execute(sql`create schema if not exists moviefinder`);
  // Nothing may resolve outside the schema: unqualified names must fail, not hit public.
  await db.execute(
    sql`alter database ${sql.identifier(parsed.pathname.slice(1))} set search_path = ''`,
  );
  await pool.end();
  await run([
    "atlas",
    "migrate",
    "apply",
    "--url",
    url,
    "--revisions-schema",
    "moviefinder",
    "--dir",
    "file://atlas/migrations",
  ]);
  await run(
    mode === "e2e"
      ? ["bun", "x", "--no-install", "playwright", "test", ...process.argv.slice(3)]
      : ["bun", "x", "--no-install", "vp", "test", "run", "--project", "integration"],
    { ...process.env, TEST_DATABASE_URL: url },
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "Database verification failed");
  exitCode = 1;
} finally {
  await embedded?.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
}
process.exit(exitCode);
