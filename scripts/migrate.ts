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
const child = Bun.spawn(["atlas", ...commands[action]!], {
  stdout: "inherit",
  stderr: "inherit",
  env: scoped ? { ...process.env, DATABASE_URL: scoped } : process.env,
});
process.exit(await child.exited);
