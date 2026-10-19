import EmbeddedPostgres from "embedded-postgres";
import { mkdir, readFile, writeFile, realpath } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import pg from "pg";
import { z } from "zod";
import { schemaScopedUrl } from "../src/server/db/scope";

async function availablePort() {
  const socket = createServer();
  await new Promise<void>((accept, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", accept);
  });
  const address = socket.address();
  if (!address || typeof address === "string")
    throw new Error("Could not reserve a local database port");
  await new Promise<void>((accept, reject) =>
    socket.close((error) => (error ? reject(error) : accept())),
  );
  return address.port;
}

// The URL is created here, never derived from the shared Vault DATABASE_URL.
export async function openLocalDatabase(
  directory = resolve(".local"),
  databaseName: "moviefinder_local" | "moviefinder_test" = "moviefinder_local",
) {
  const root = resolve(directory),
    data = join(root, "postgres");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const credentials = join(root, "postgres.json");
  try {
    await writeFile(
      credentials,
      JSON.stringify({ password: crypto.randomUUID() + crypto.randomUUID() }),
      { flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST"))
      throw error;
  }
  const { password } = z
    .object({ password: z.string().min(32) })
    .parse(JSON.parse(await readFile(credentials, "utf8")));
  let port: number | undefined;
  try {
    const pidFile = (await readFile(join(data, "postmaster.pid"), "utf8")).split("\n");
    const pid = Number(pidFile[0]),
      runningPort = Number(pidFile[3]);
    if (
      Number.isInteger(pid) &&
      pid > 0 &&
      Number.isInteger(runningPort) &&
      runningPort > 0 &&
      runningPort < 65536
    ) {
      process.kill(pid, 0);
      port = runningPort;
    }
  } catch (error) {
    if (
      !(
        error &&
        typeof error === "object" &&
        "code" in error &&
        ["ENOENT", "ESRCH"].includes(String(error.code))
      )
    )
      throw error;
  }
  let cluster: EmbeddedPostgres | undefined;
  const stop = async () => {
    const owned = cluster;
    cluster = undefined;
    if (owned) await owned.stop();
  };
  try {
    if (!port) {
      port = await availablePort();
      cluster = new EmbeddedPostgres({
        databaseDir: data,
        port,
        user: "postgres",
        password,
        authMethod: "scram-sha-256",
        persistent: true,
        createPostgresUser: false,
        postgresFlags: [
          "-h",
          "127.0.0.1",
          "-c",
          "unix_socket_directories=",
          "-c",
          "log_statement=none",
          "-c",
          "log_min_error_statement=panic",
        ],
        onLog: () => {},
        onError: () => {},
      });
      try {
        await readFile(join(data, "PG_VERSION"), "utf8");
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT"))
          throw error;
        const previousMask = process.umask(0o077);
        try {
          await cluster.initialise();
        } finally {
          process.umask(previousMask);
        }
      }
      await cluster.start();
    }
    const base = `postgres://postgres:${encodeURIComponent(password)}@127.0.0.1:${port}`;
    const admin = new pg.Client({
      connectionString: `${base}/postgres?sslmode=disable`,
      connectionTimeoutMillis: 10000,
    });
    try {
      await admin.connect();
      const result = await admin.query("show data_directory");
      if ((await realpath(result.rows[0].data_directory)) !== (await realpath(data)))
        throw new Error(
          "Refusing a PostgreSQL process outside this checkout's local data directory",
        );
      if (
        !(await admin.query("select 1 from pg_database where datname = $1", [databaseName]))
          .rowCount
      )
        await admin.query(`create database "${databaseName}"`);
    } finally {
      await admin.end();
    }
    const url = `${base}/${databaseName}?sslmode=disable`;
    const client = new pg.Client({ connectionString: url });
    try {
      await client.connect();
      await client.query("create schema if not exists moviefinder");
    } finally {
      await client.end();
    }
    return { url, stop };
  } catch {
    await stop();
    throw new Error(
      "Could not start this checkout's embedded PostgreSQL. Check package installation, local data permissions, and whether another startup is already in progress. Local data has been preserved.",
    );
  }
}

function localTarget(url: string) {
  const target = new URL(url);
  if (
    target.hostname !== "127.0.0.1" ||
    !["/moviefinder_local", "/moviefinder_test"].includes(target.pathname)
  )
    throw new Error("Local migrations require the embedded loopback database");
  return target;
}

export async function openAtlasScratch(url: string) {
  const target = localTarget(url);
  const name = `moviefinder_atlas_${crypto.randomUUID().replaceAll("-", "")}`;
  target.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: target.toString() });
  try {
    await admin.connect();
    await admin.query(`create database "${name}"`);
    target.pathname = `/${name}`;
    return {
      url: target.toString(),
      async stop() {
        try {
          await admin.query(`drop database if exists "${name}" with (force)`);
        } finally {
          await admin.end();
        }
      },
    };
  } catch (error) {
    await admin.end();
    throw error;
  }
}

export async function migrateLocalDatabase(
  url: string,
  action: "apply" | "status" | "drift" = "apply",
) {
  localTarget(url);
  const scratch = action === "drift" ? await openAtlasScratch(url) : undefined;
  try {
    const args =
      action === "drift"
        ? [
            "schema",
            "diff",
            "--from",
            "env://url",
            "--to",
            "file://atlas/schema.sql",
            "--env",
            "app",
            "--dev-url",
            scratch!.url,
          ]
        : ["migrate", action, "--env", "app"];
    const child = spawn("atlas", args, {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: action === "drift" ? url : schemaScopedUrl(url) },
    });
    const code = await new Promise<number | null>((accept, reject) => {
      child.once("error", reject);
      child.once("exit", accept);
    });
    if (code !== 0) throw new Error("Local Atlas migration failed; local data has been preserved.");
  } finally {
    await scratch?.stop();
  }
}
