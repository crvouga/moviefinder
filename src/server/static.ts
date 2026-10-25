import { resolve, extname } from "node:path";
import type { Hono, Env } from "hono";
import type { AuthForRequest } from "./auth-origins";
export function serveClient<E extends Env>(app: Hono<E>, authForRequest: AuthForRequest) {
  const staticRoot = resolve("dist");
  app.get("*", async (c) => {
    if (c.req.path.startsWith("/api/")) return c.json({ error: "API route not found" }, 404);
    const path = resolve(staticRoot, `.${c.req.path}`);
    if (path.startsWith(`${staticRoot}/`) && extname(path)) {
      const file = Bun.file(path);
      if (await file.exists()) {
        if (c.req.path.startsWith("/assets/"))
          c.header("Cache-Control", "public, max-age=31536000, immutable");
        return new Response(file, { headers: c.res.headers });
      }
      return c.notFound();
    }
    if (!c.req.path.startsWith("/auth")) {
      const instance = authForRequest(c.req.raw);
      if (!instance) return c.text("Untrusted request host", 403);
      const session = await instance.auth.api.getSession({ headers: c.req.raw.headers });
      if (!session)
        return c.redirect(
          `/auth?returnTo=${encodeURIComponent(c.req.path + new URL(c.req.url).search)}`,
        );
    }
    const file = Bun.file(resolve(staticRoot, "index.html"));
    if (!(await file.exists()))
      return c.text("Build the client with bun run build before starting production.", 503);
    return c.html(await file.text());
  });
}
