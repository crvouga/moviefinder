import { openLocalDatabase, migrateLocalDatabase } from "./local-database";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { localDevAuth } from "./local-auth-relay";
// Cookies on localhost are shared across ports, so other dev apps can push requests past the 16KB default.
const headerLimit = 131072;
const children = new Map<ChildProcess, Promise<number>>();
const pidFile = ".local/dev.pid";
let stopping = false;
let exitCode = 0;
const abort = () => {
  stopping = true;
  for (const child of children.keys()) {
    if (!child.pid) continue;
    try {
      if (process.platform === "win32") child.kill();
      else process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      // macOS reports EPERM instead of ESRCH for a process group whose leader already exited.
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code !== "ESRCH" && code !== "EPERM") throw error;
    }
  }
};
function launch(args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(args[0]!, args.slice(1), {
    stdio: "inherit",
    env,
    detached: process.platform !== "win32",
  });
  const exited = new Promise<number>((accept, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => accept(code ?? 0));
  });
  children.set(child, exited);
  return exited;
}
process.on("SIGINT", abort);
process.on("SIGTERM", abort);
process.on("SIGHUP", abort);
function freePort() {
  return new Promise<number>((accept, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "0.0.0.0", () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === "object" && address
          ? accept(address.port)
          : reject(new Error("No port")),
      );
    });
  });
}
let database: Awaited<ReturnType<typeof openLocalDatabase>> | undefined;
try {
  await mkdir(".local", { recursive: true, mode: 0o700 });
  const previous = Number(await readFile(pidFile, "utf8").catch(() => ""));
  if (Number.isInteger(previous) && previous > 0) {
    try {
      process.kill(previous, 0);
      throw new Error(
        "MovieFinder is already running in this checkout. Stop its existing launcher first.",
      );
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ESRCH"))
        throw error;
    }
  }
  await rm(pidFile, { force: true });
  await writeFile(pidFile, String(process.pid), { mode: 0o600, flag: "wx" });
  database = await openLocalDatabase();
  if (!stopping) {
    await migrateLocalDatabase(database.url);
    if (!stopping) {
      const relay = await localDevAuth(process.env);
      const configuredWebPort = process.env.MOVIEFINDER_WEB_PORT ?? relay?.port;
      const webPort = configuredWebPort ? Number(configuredWebPort) : await freePort();
      if (!Number.isInteger(webPort) || webPort < 1 || webPort > 65535)
        throw new Error("MOVIEFINDER_WEB_PORT must be an integer from 1 to 65535");
      const apiPort = await freePort();
      const origin = `http://localhost:${webPort}`;
      if (!relay)
        console.warn(
          "Google sign-in is not configured in this checkout. Save its approved registration to .local/auth-relay.json (see docs/auth-relay.md).",
        );
      const env = {
        ...process.env,
        ...(relay
          ? { MOVIEFINDER_OIDC_ISSUER: relay.issuer, MOVIEFINDER_OIDC_CLIENT_ID: relay.clientId }
          : {}),
        DATABASE_URL: database.url,
        NODE_ENV: "development",
        MOVIEFINDER_ORIGIN: origin,
        MOVIEFINDER_WEB_PORT: String(webPort),
        PORT: String(apiPort),
        MOVIEFINDER_TELEMETRY_DIR: ".local/telemetry",
      };
      console.log(`Local PostgreSQL ready. Starting MovieFinder at ${origin}`);
      const backend = launch(
        ["bun", `--max-http-header-size=${headerLimit}`, "--watch", "src/server/index.ts"],
        env,
      );
      const frontend = launch(["bun", "x", "--no-install", "vp", "dev"], {
        ...env,
        NODE_OPTIONS:
          `${process.env.NODE_OPTIONS ?? ""} --max-http-header-size=${headerLimit}`.trim(),
      });
      exitCode = await Promise.race([backend, frontend]);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Local development startup failed");
  exitCode = 1;
} finally {
  abort();
  await Promise.allSettled(children.values());
  await database?.stop();
  if ((await readFile(pidFile, "utf8").catch(() => "")) === String(process.pid))
    await rm(pidFile, { force: true });
}
process.exit(exitCode);
