const platform = process.env.CONTAINER_PLATFORM ?? "linux/amd64";
const image = process.argv[2] ?? "moviefinder:verification",
  container = `moviefinder-image-smoke-${process.pid}`;
async function docker(args: string[], capture = false, env = process.env) {
  const child = Bun.spawn(["docker", ...args], {
    stdout: capture ? "pipe" : "inherit",
    stderr: "inherit",
    env,
  });
  const output = capture ? await new Response(child.stdout).text() : "";
  const code = await child.exited;
  if (code !== 0) throw new Error(`docker ${args[0]} failed (${code})`);
  return output;
}
let created = false;
try {
  // These are disposable process-only test values, never shared Vault credentials.
  const env = {
    ...process.env,
    MOVIEFINDER_AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID(),
    DATABASE_URL: "postgres://unreachable:local-only@127.0.0.1:1/moviefinder_test?sslmode=disable",
    MOVIEFINDER_ORIGIN: "http://127.0.0.1:8080",
    MOVIEFINDER_OIDC_ISSUER: "https://auth.chrisvouga.dev/realms/projects",
    MOVIEFINDER_OIDC_CLIENT_ID: "app-container-smoke-test",
    PORT: "8080",
  };
  await docker(
    [
      "run",
      "--detach",
      "--name",
      container,
      "--platform",
      platform,
      "-p",
      "127.0.0.1::8080",
      "-e",
      "MOVIEFINDER_AUTH_SECRET",
      "-e",
      "DATABASE_URL",
      "-e",
      "MOVIEFINDER_ORIGIN",
      "-e",
      "MOVIEFINDER_OIDC_ISSUER",
      "-e",
      "MOVIEFINDER_OIDC_CLIENT_ID",
      "-e",
      "PORT",
      image,
    ],
    true,
    env,
  );
  created = true;
  const mapping = (await docker(["port", container, "8080/tcp"], true)).trim(),
    origin = `http://${mapping}`;
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1500) });
      if (r.ok && (await r.json()).service === "moviefinder") {
        ready = true;
        break;
      }
    } catch {}
    await Bun.sleep(500);
  }
  if (!ready) {
    await docker(["logs", "--tail", "30", container]);
    throw new Error("Container liveness did not become ready");
  }
  const auth = await fetch(`${origin}/auth`),
    protectedApi = await fetch(`${origin}/api/state`),
    deepLink = await fetch(`${origin}/title/tmdb%3Amovie%3A550`, { redirect: "manual" });
  if (auth.status !== 200 || !(await auth.text()).includes('<div id="root">'))
    throw new Error("Compiled authentication application not served");
  if (protectedApi.status !== 401 || deepLink.status !== 302)
    throw new Error("Production authentication boundary failed");
  console.log(
    `${platform} image smoke passed: /health 200 with PostgreSQL unavailable; /auth 200; protected API 401; protected deep link 302.`,
  );
  const inspect = JSON.parse(await docker(["image", "inspect", image], true));
  console.log(JSON.stringify({ architecture: inspect[0].Architecture, bytes: inspect[0].Size }));
} finally {
  if (created) await docker(["rm", "--force", container], true);
}

export {};
