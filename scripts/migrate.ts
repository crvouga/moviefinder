import { schemaScopedUrl } from "../src/server/db/scope";
// Atlas is the only migration writer and applier. Never infer shared allocation from a URL.
const action = process.argv[2] ?? "status";
if (!["apply", "status", "diff", "drift"].includes(action))
  throw new Error("Expected apply, status, diff, or drift");
if (action === "apply" && process.env.MOVIEFINDER_DATABASE_ALLOCATION !== "moviefinder")
  throw new Error(
    "Blocked: MOVIEFINDER_DATABASE_ALLOCATION must confirm the approved moviefinder schema allocation. Obtain it via crvouga/workspace OpenTofu; never set it to bypass approval.",
  );
if (action === "diff") {
  const child = Bun.spawn(["bun", "scripts/schema-diff.ts", process.argv[3] ?? "change"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(await child.exited);
}
// Apply/status must be schema-scoped (see scope.ts); drift filters with atlas.hcl `schemas`.
const scoped =
  process.env.DATABASE_URL && action !== "drift"
    ? schemaScopedUrl(process.env.DATABASE_URL)
    : undefined;
const commands: Record<string, string[]> = {
  apply: ["migrate", "apply", "--env", "app"],
  status: ["migrate", "status", "--env", "app"],
  diff: ["migrate", "diff", process.argv[3] ?? "change", "--env", "app"],
  drift: [
    "schema",
    "diff",
    "--from",
    "env://url",
    "--to",
    "file://atlas/schema.sql",
    "--env",
    "app",
  ],
};
// Atlas must never reach out for update checks or telemetry from CI, and a stalled child must fail
// loudly well before the job timeout instead of hanging after its work is done.
const WATCHDOG_MS = 5 * 60_000;
const child = Bun.spawn(["atlas", ...commands[action]!], {
  stdout: "inherit",
  stderr: "inherit",
  env: {
    ...process.env,
    ...(scoped ? { DATABASE_URL: scoped } : {}),
    ATLAS_NO_UPDATE_NOTIFIER: "1",
  },
});
const watchdog = setTimeout(() => {
  console.error(`atlas ${action} did not exit within ${WATCHDOG_MS / 1000}s; terminating it.`);
  child.kill("SIGKILL");
}, WATCHDOG_MS);
const code = await child.exited;
clearTimeout(watchdog);
process.exit(code);
