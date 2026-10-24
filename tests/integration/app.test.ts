import { beforeAll, afterAll, describe, it, expect, vi } from "vite-plus/test";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../../src/server/db";
import { assertDatabaseReady, DatabaseNotReady } from "../../src/server/db/readiness";
import { createApplication } from "../../src/server/app";
import { createEntityStore } from "../../src/server/entity-store";
import { executeCommand } from "../../src/server/commands";
import { createQueries } from "../../src/server/queries";
import { createSync } from "../../src/server/entity-store-sync";
import { readConfig } from "../../src/server/config";
import { replay, currentCursor } from "../../src/server/events";
import { snapshot } from "../../src/server/state";
import * as schema from "../../src/server/db/schema";
import { type Command, feedParams } from "../../src/shared/contracts";
import { movie, movieDetail, television, fixtureUpstream } from "../fixtures/catalog";
import {
  startGoogle,
  googleSignIn,
  googleCallback,
  type GoogleTestProvider,
} from "../fixtures/google";
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !["127.0.0.1", "localhost"].includes(new URL(url).hostname) ||
  !new URL(url).pathname.endsWith("_test")
)
  throw new Error(
    "Integration tests require a disposable loopback TEST_DATABASE_URL whose database name ends in _test. Run bun run test:integration.",
  );
const { db, pool } = createDatabase(url),
  config = readConfig({
    DATABASE_URL: url,
    BETTER_AUTH_SECRET: "isolated-test-auth-secret-at-least-32-characters",
    MOVIEFINDER_ORIGIN: "http://localhost:5173",
    NODE_ENV: "test",
  }),
  store = createEntityStore(db);
let service: ReturnType<typeof createApplication>;
let google: GoogleTestProvider;
let owner = "",
  editor = "",
  viewer = "",
  listId = "",
  ownerCookie = "";
const cmd = (userId: string, command: Omit<Command, "operationId">) =>
  executeCommand(db, userId, { ...command, operationId: crypto.randomUUID() } as Command);
async function register(name: string) {
  const signedIn = await googleSignIn(service, google, config.MOVIEFINDER_ORIGIN, {
    id: name,
    email: `${name}@example.test`,
    name,
  });
  await db
    .update(schema.user)
    .set({ username: name, displayUsername: name })
    .where(eq(schema.user.id, signedIn.id));
  return signedIn;
}
beforeAll(async () => {
  google = await startGoogle(config.MOVIEFINDER_ORIGIN);
  service = createApplication(db, { ...config, ...google.config }, fixtureUpstream);
  await db.execute(
    sql`truncate moviefinder."user",moviefinder.source_entity,moviefinder.query_cache,moviefinder.sync_job,moviefinder.event cascade`,
  );
  const a = await register("owner");
  owner = a.id;
  ownerCookie = a.cookie;
  editor = (await register("editor")).id;
  viewer = (await register("viewer")).id;
  await db.transaction(async (tx) => {
    await store.ingest(tx, "tmdb:movie:550", movieDetail, "detail");
    await store.ingest(tx, "tmdb:tv:1399", television);
  });
});
afterAll(async () => {
  service.stop();
  await google.close();
  await pool.end();
});
describe("real PostgreSQL authentication and authorization", () => {
  it("persists user, account, and session records", async () => {
    expect((await db.select().from(schema.user)).length).toBe(3);
    expect((await db.select().from(schema.account)).length).toBe(3);
    expect((await db.select().from(schema.session)).length).toBe(3);
  });
  it("protects every application API while keeping liveness independent", async () => {
    expect((await service.app.request("/health")).status).toBe(200);
    expect((await service.app.request("/api/state")).status).toBe(401);
    expect((await service.app.request("/api/discover")).status).toBe(401);
    expect((await service.app.request("/api/events")).status).toBe(401);
  });
  it("restores a persisted cookie session and excludes authentication internals", async () => {
    const res = await service.app.request("/api/state", { headers: { Cookie: ownerCookie } });
    expect(res.status).toBe(200);
    const state = await res.json();
    expect(state.entities.some((e: { id: string }) => e.id === owner)).toBe(true);
    expect(JSON.stringify(state)).not.toContain("a-strong-test-password");
    expect(
      state.entities
        .filter((e: { kind: string }) => e.kind === "user")
        .every((e: { data: Record<string, unknown> }) => !("email" in e.data)),
    ).toBe(true);
  });
  it("rejects cross-origin commands", async () => {
    expect(
      (
        await service.app.request("/api/command", {
          method: "POST",
          headers: {
            Cookie: ownerCookie,
            Origin: "https://untrusted.example",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "status",
            titleId: "tmdb:movie:550",
            seen: true,
            operationId: crypto.randomUUID(),
          }),
        })
      ).status,
    ).toBe(403);
  });
  it("supports logout and rejects an expired/revoked session", async () => {
    const a = await register("logoutuser");
    const res = await service.app.request("/api/auth/sign-out", {
      method: "POST",
      headers: {
        Cookie: a.cookie,
        Origin: config.MOVIEFINDER_ORIGIN,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(
      (await service.app.request("/api/state", { headers: { Cookie: a.cookie } })).status,
    ).toBe(401);
  });
});
describe("transactional user state", () => {
  it("maintains independent dimensions under concurrent updates", async () => {
    await Promise.all([
      cmd(owner, { type: "status", titleId: "tmdb:movie:550", seen: true } as never),
      cmd(owner, { type: "status", titleId: "tmdb:movie:550", sentiment: "liked" } as never),
    ]);
    const rows = await db.select().from(schema.statuses).where(eq(schema.statuses.userId, owner));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ seen: true, sentiment: "liked" });
  });
  it("deduplicates retries and rejects reuse for different payloads", async () => {
    const operation = {
      type: "status",
      titleId: "tmdb:movie:550",
      seen: false,
      operationId: crypto.randomUUID(),
    } as const;
    const results = await Promise.all([
      executeCommand(db, owner, operation),
      executeCommand(db, owner, operation),
    ]);
    expect(results[0]).toEqual(results[1]);
    await expect(executeCommand(db, owner, { ...operation, seen: true })).rejects.toMatchObject({
      status: 409,
    });
  });
  it("persists the state and its event atomically", async () => {
    const before = Number(await currentCursor(db));
    await cmd(owner, { type: "status", titleId: "tmdb:movie:550", sentiment: "meh" } as never);
    const rows = await replay(db, owner, before);
    expect(
      rows.some((e) =>
        e.payload.entities.some((e) => e.kind === "status" && e.data.sentiment === "meh"),
      ),
    ).toBe(true);
  });
});
describe("collaborative lists with concurrent database commands", () => {
  it("creates a list and grants only its creator ownership", async () => {
    const result = await cmd(owner, {
      type: "list.create",
      title: "Test movie night",
      description: "Shared picks",
    } as never);
    listId = result.entities.find((e) => e.kind === "list")!.id;
    expect(result.entities.find((e) => e.kind === "collaborator")?.data.role).toBe("owner");
  });
  it("rejects a public viewer edit", async () => {
    await expect(
      cmd(viewer, { type: "list.add", listId, titleId: "tmdb:movie:550" } as never),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("requires an invitation to be accepted by its intended recipient", async () => {
    const result = await cmd(owner, { type: "list.invite", listId, userId: editor } as never),
      inv = result.entities.find((e) => e.kind === "invitation")!;
    await expect(
      cmd(viewer, { type: "invitation.accept", invitationId: inv.id } as never),
    ).rejects.toMatchObject({ status: 403 });
    await cmd(editor, { type: "invitation.accept", invitationId: inv.id } as never);
    await expect(
      cmd(editor, { type: "list.edit", listId, title: "Not allowed", description: "" } as never),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("deduplicates concurrent additions without losing distinct titles", async () => {
    await Promise.all([
      cmd(owner, { type: "list.add", listId, titleId: "tmdb:movie:550" } as never),
      cmd(editor, { type: "list.add", listId, titleId: "tmdb:movie:550" } as never),
      cmd(editor, { type: "list.add", listId, titleId: "tmdb:tv:1399" } as never),
    ]);
    expect(
      await db.select().from(schema.items).where(eq(schema.items.listId, listId)),
    ).toHaveLength(2);
  });
  it("serializes individual item moves and preserves concurrently added entries", async () => {
    const rows = await db.select().from(schema.items).where(eq(schema.items.listId, listId));
    await Promise.all([
      cmd(owner, { type: "list.move", listId, itemId: rows[0]!.id, beforeId: null } as never),
      cmd(editor, {
        type: "list.move",
        listId,
        itemId: rows[1]!.id,
        beforeId: rows[0]!.id,
      } as never),
    ]);
    const after = await db.select().from(schema.items).where(eq(schema.items.listId, listId));
    expect(after).toHaveLength(2);
    expect(new Set(after.map((r) => r.orderKey)).size).toBe(2);
  });
  it("copies public contents with fresh stable item IDs", async () => {
    const result = await cmd(viewer, { type: "list.copy", listId } as never);
    expect(result.entities.filter((e) => e.kind === "item")).toHaveLength(2);
    expect(result.entities.find((e) => e.kind === "list")?.data.ownerId).toBe(viewer);
  });
  it("replays committed list events in ascending order without exposing private feed events", async () => {
    const before = Number(await currentCursor(db));
    await cmd(owner, {
      type: "feed.save",
      title: "Private preference",
      params: feedParams.parse({}),
    } as never);
    await cmd(owner, {
      type: "list.edit",
      listId,
      title: "A better movie night",
      description: "",
    } as never);
    const rows = await replay(db, editor, before);
    expect(rows.some((r) => r.payload.entities.some((e) => e.kind === "list"))).toBe(true);
    expect(rows.some((r) => r.payload.entities.some((e) => e.kind === "feed"))).toBe(false);
    expect(rows.map((r) => r.id)).toEqual(rows.map((r) => r.id).sort((a, b) => a - b));
  });
  it("removes editor authorization immediately", async () => {
    await cmd(owner, { type: "list.member.remove", listId, userId: editor } as never);
    await expect(
      cmd(editor, { type: "list.remove", listId, itemId: crypto.randomUUID() } as never),
    ).rejects.toMatchObject({ status: 403 });
  });
});
describe("cache-first catalog and durable synchronization", () => {
  it("returns an explicit partial cache result without waiting for upstream", async () => {
    let calls = 0;
    const isolated = createSync(db, async (path, p) => {
        calls++;
        return fixtureUpstream(path, p);
      }),
      query = createQueries(db, isolated);
    const result = await query.discover({ type: "movie", seed: "cold-query" }, owner);
    expect(calls).toBe(0);
    expect(["partial", "missing"]).toContain(result.coverage.state);
    const jobs = await db.select().from(schema.jobs).where(eq(schema.jobs.id, result.id));
    expect(jobs).toHaveLength(1);
    await isolated.runJob(jobs[0]!);
    expect(calls).toBe(1);
    const hydrated = await query.discover({ type: "movie", seed: "cold-query" }, owner);
    expect(hydrated.coverage.state).toBe("complete");
    expect(hydrated.ids.length).toBeGreaterThan(0);
    expect(hydrated.coverage.nextCursor).toBeTruthy();
  });
  it("coalesces simultaneous missing-entity requests into one durable job", async () => {
    await Promise.all(Array.from({ length: 10 }, () => service.sync.hydrate("tmdb:movie:999")));
    expect(
      await db.select().from(schema.jobs).where(eq(schema.jobs.id, "entity:tmdb:movie:999")),
    ).toHaveLength(1);
  });
  it("never overwrites hydrated credits with a summary response", async () => {
    await db.transaction((tx) => store.ingest(tx, "tmdb:movie:550", movie));
    const [row] = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.id, "tmdb:movie:550"));
    expect(row?.projection).toBe("detail");
    expect(row?.payload.credits).toEqual(movieDetail.credits);
  });
  it("does not corrupt the previous source document after a provider failure", async () => {
    const [before] = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.id, "tmdb:movie:550"));
    await expect(
      db.transaction((tx) => store.ingest(tx, "tmdb:movie:550", { id: "invalid" })),
    ).rejects.toThrow();
    const [after] = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.id, "tmdb:movie:550"));
    expect(after?.payload).toEqual(before?.payload);
  });
  it("pairs a consistent snapshot with a durable replay cursor", async () => {
    const state = await snapshot(db, owner);
    expect(Number(state.cursor)).toBeGreaterThan(0);
    expect(state.entities.some((e) => e.kind === "list")).toBe(true);
    const after = await replay(db, owner, Number(state.cursor));
    expect(after).toHaveLength(0);
  });
});

describe("recovery and social boundaries", () => {
  it.each([
    "sign-up/email",
    "sign-in/email",
    "sign-in/username",
    "request-password-reset",
    "reset-password",
    "change-password",
    "set-password",
    "verify-password",
  ])("rejects the disabled credential endpoint %s", async (path) => {
    const response = await service.app.request(`/api/auth/${path}`, {
      method: "POST",
      headers: { Origin: config.MOVIEFINDER_ORIGIN, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(404);
  });
  it("rejects legacy token-specific password reset links", async () => {
    expect(
      (await service.app.request("/api/auth/reset-password/obsolete-fixture-token")).status,
    ).toBe(404);
  });
  it("searches registered users and public lists through the database", async () => {
    const result = await service.app.request("/api/social-search?q=owner", {
      headers: { Cookie: (await register("searcher")).cookie },
    });
    expect(result.status).toBe(200);
    const value = await result.json();
    expect(
      value.entities.some((e: { kind: string; id: string }) => e.kind === "user" && e.id === owner),
    ).toBe(true);
    expect(
      value.entities.every((e: { data: Record<string, unknown> }) => !("email" in e.data)),
    ).toBe(true);
  });
  it("returns scoped list projections with title metadata", async () => {
    const cookie = (await register("listreader")).cookie;
    const res = await service.app.request(`/api/lists/${listId}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const value = await res.json();
    expect(value.entities.filter((e: { kind: string }) => e.kind === "item")).toHaveLength(2);
    expect(value.entities.some((e: { kind: string }) => e.kind === "movie")).toBe(true);
  });
  it("allows save, unsave, and save again with fresh stable identities", async () => {
    const first = await cmd(viewer, { type: "list.follow", listId, follow: true } as never);
    await cmd(viewer, { type: "list.follow", listId, follow: false } as never);
    const again = await cmd(viewer, { type: "list.follow", listId, follow: true } as never);
    expect(first.entities.find((e) => e.kind === "follow")?.id).not.toBe(
      again.entities.find((e) => e.kind === "follow")?.id,
    );
  });
});
it("merges sorted movie and television source streams across page boundaries", async () => {
  const sync = createSync(db, fixtureUpstream),
    query = createQueries(db, sync),
    params = feedParams.parse({ type: "both", seed: "global-order-test" });
  let result = await query.discover(params, viewer);
  let [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, result.id));
  await sync.runJob(job!);
  result = await query.discover(params, viewer);
  expect(result.coverage.state).toBe("complete");
  expect(result.ids).toHaveLength(20);
  const all = [...result.ids];
  expect(result.coverage.nextCursor).toBeTruthy();
  const nextParams = { ...params, cursor: result.coverage.nextCursor! };
  let next = await query.discover(nextParams, viewer);
  [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, next.id));
  await sync.runJob(job!);
  next = await query.discover(nextParams, viewer);
  all.push(...next.ids);
  expect(new Set(all).size).toBe(25);
  const records = await db
      .select()
      .from(schema.sources)
      .where(
        sql`${schema.sources.id} in (${sql.join(
          all.map((id) => sql`${id}`),
          sql`,`,
        )})`,
      ),
    map = new Map(records.map((r) => [r.id, r.popularity])),
    scores = all.map((id) => map.get(id)!);
  expect(scores).toEqual([...scores].sort((a, b) => b - a));
  expect(next.coverage.nextCursor).toBeNull();
});
it("ingests an unchanged source idempotently without manufacturing a new revision", async () => {
  const [before] = await db
    .select()
    .from(schema.sources)
    .where(eq(schema.sources.id, "tmdb:movie:550"));
  await db.transaction((tx) => store.ingest(tx, "tmdb:movie:550", before!.payload, "detail"));
  const [after] = await db
    .select()
    .from(schema.sources)
    .where(eq(schema.sources.id, "tmdb:movie:550"));
  expect(after?.version).toBe(before?.version);
});
it("streams committed changes after Last-Event-ID and releases a disconnected subscriber", async () => {
  const readerUser = await register("streamreader"),
    cursor = await currentCursor(db),
    response = await service.app.request(`/api/events?cursor=0`, {
      headers: { Cookie: readerUser.cookie, "Last-Event-ID": cursor },
    });
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const reader = response.body!.getReader();
  try {
    await cmd(readerUser.id, {
      type: "status",
      titleId: "tmdb:movie:550",
      sentiment: "liked",
    } as never);
    let text = "";
    for (let i = 0; i < 8 && !text.includes('"kind":"status"'); i++) {
      const part = await reader.read();
      if (part.done) break;
      text += new TextDecoder().decode(part.value);
    }
    expect(text).toContain('"kind":"status"');
    const eventIds = [...text.matchAll(/^id: (\d+)/gm)].map((m) => Number(m[1]));
    expect(eventIds.length).toBeGreaterThan(0);
    expect(eventIds.every((id) => id > Number(cursor))).toBe(true);
  } finally {
    await reader.cancel();
  }
});
it("recovers a cursor older than retained history with a consistent snapshot reset", async () => {
  const actor = await register("snapshotreader");
  await db.delete(schema.events);
  await cmd(actor.id, { type: "status", titleId: "tmdb:movie:550", seen: true } as never);
  const response = await service.app.request("/api/events?cursor=1", {
      headers: { Cookie: actor.cookie },
    }),
    reader = response.body!.getReader();
  try {
    const first = await reader.read(),
      text = new TextDecoder().decode(first.value);
    expect(text).toContain('"type":"reset"');
    expect(text).toContain('"subscription":"snapshot"');
    expect(text).toContain(actor.id);
  } finally {
    await reader.cancel();
  }
});
it("persists provider cooldown across synchronization worker instances", async () => {
  const { UpstreamError } = await import("../../src/server/entity-store-sync/tmdb");
  let calls = 0;
  const first = createSync(db, async () => {
      throw new UpstreamError(429, 60000);
    }),
    second = createSync(db, async (path, p) => {
      calls++;
      return fixtureUpstream(path, p);
    });
  await first.hydrate("tmdb:movie:99991");
  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.id, "entity:tmdb:movie:99991"));
  try {
    await expect(first.runJob(job!)).rejects.toMatchObject({ status: 429 });
    await expect(second.runJob(job!)).rejects.toMatchObject({ status: 429 });
    expect(calls).toBe(0);
  } finally {
    await db.delete(schema.checkpoints);
  }
});
it("reclaims an expired synchronization lease after a worker restart", async () => {
  await db.delete(schema.jobs);
  await db.insert(schema.jobs).values({
    id: "entity:tmdb:movie:8888",
    kind: "entity",
    params: { id: "tmdb:movie:8888" },
    state: "running",
    leaseUntil: new Date(Date.now() - 10000),
    runAt: new Date(Date.now() - 20000),
    attempts: 1,
  });
  const recovered = createSync(db, fixtureUpstream);
  try {
    await recovered.tick();
    const [job] = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, "entity:tmdb:movie:8888"));
    expect(job?.state).toBe("done");
    expect(job?.attempts).toBe(2);
  } finally {
    recovered.stop();
  }
});
it("retains an explicitly partial movie page when the television source fails", async () => {
  const failing = createSync(db, async (path, p) => {
      if (path === "discover/tv") throw new Error("fixture provider unavailable");
      return fixtureUpstream(path, p);
    }),
    query = createQueries(db, failing),
    params = feedParams.parse({ type: "both", seed: "partial-source-failure" });
  let result = await query.discover(params, viewer);
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, result.id));
  await expect(failing.runJob(job!)).rejects.toThrow();
  result = await query.discover(params, viewer);
  expect(result.coverage.state).toBe("partial");
  expect(result.ids.length).toBeGreaterThan(0);
  expect(result.ids.every((id) => id.startsWith("tmdb:movie:"))).toBe(true);
});
it("revokes pending grants when an owner removes a collaborator or cancels an invitation", async () => {
  const invited = await cmd(owner, { type: "list.invite", listId, userId: editor } as never),
    invitationId = invited.entities.find((e) => e.kind === "invitation")!.id;
  await cmd(owner, { type: "list.member.remove", listId, userId: editor } as never);
  await expect(
    cmd(editor, { type: "invitation.accept", invitationId } as never),
  ).rejects.toMatchObject({ status: 409 });
});

describe("database initialization diagnostics", () => {
  it("checks all required tables and columns in a read-only transaction", async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set transaction read only`);
      await expect(assertDatabaseReady(tx)).resolves.toBeUndefined();
    });
  });
  it("reports missing columns from unapplied additive migrations", async () => {
    await db.execute(
      sql`alter table moviefinder.source_entity rename column detail_fetched_at to detail_fetched_at_pending`,
    );
    try {
      await expect(assertDatabaseReady(db)).rejects.toMatchObject({
        missing: ["moviefinder.source_entity.detail_fetched_at"],
      });
    } finally {
      await db.execute(
        sql`alter table moviefinder.source_entity rename column detail_fetched_at_pending to detail_fetched_at`,
      );
    }
  });
  it("returns a safe Google callback failure without printing SQL parameters for a missing user table", async () => {
    await db.execute(sql`alter table moviefinder."user" rename to user_pending_migrations`);
    const output = vi.spyOn(console, "log").mockImplementation(() => {}),
      errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(assertDatabaseReady(db)).rejects.toBeInstanceOf(DatabaseNotReady);
      const response = await googleCallback(service, google, config.MOVIEFINDER_ORIGIN, {
        id: "missing_table",
        email: "never-log-this@example.test",
        name: "Missing table fixture",
      });
      expect(response.status).toBe(302);
      const destination = new URL(response.headers.get("location")!);
      expect(destination.origin).toBe(config.MOVIEFINDER_ORIGIN);
      expect(destination.pathname).toBe("/auth");
      expect(destination.searchParams.get("socialError")).toBe("1");
      expect(destination.searchParams.get("error")).toBe("internal_server_error");
      expect(
        response.headers.getSetCookie().some((cookie) => cookie.includes(".session_token=")),
      ).toBe(false);
      expect(errors).not.toHaveBeenCalled();
      const logged = JSON.stringify(output.mock.calls);
      expect(logged).not.toContain("never-log-this");
      expect(logged).not.toContain("Failed query");
      expect(logged).not.toContain("select");
    } finally {
      output.mockRestore();
      errors.mockRestore();
      await db.execute(sql`alter table moviefinder.user_pending_migrations rename to "user"`);
    }
  });
  it("does not expose a password fallback alongside Google sign-in", async () => {
    const response = await service.app.request("/api/auth-options");
    expect(await response.json()).toEqual({ google: true });
    expect(
      (await db.select().from(schema.account)).every((row) => row.providerId === "auth-relay"),
    ).toBe(true);
  });
  it("pauses synchronization after a missing-table error rather than polling every second", async () => {
    await db.execute(sql`alter table moviefinder.sync_job rename to sync_job_pending_migrations`);
    const output = vi.spyOn(console, "log").mockImplementation(() => {}),
      worker = createSync(db, fixtureUpstream);
    try {
      await worker.tick();
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const logs = output.mock.calls.map(([entry]) => JSON.parse(entry));
      expect(logs.filter((entry) => entry.category === "sync")).toHaveLength(1);
      expect(logs[0].message).toContain("database migrations are missing");
    } finally {
      worker.stop();
      output.mockRestore();
      await db.execute(sql`alter table moviefinder.sync_job_pending_migrations rename to sync_job`);
    }
  });
});
describe("anticipatory title reads", () => {
  const job = async (id: string) =>
    (
      await db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, `entity:${id}`))
    )[0];
  it("answers a hover read from the cache and starts no upstream work", async () => {
    const sync = createSync(db, fixtureUpstream),
      query = createQueries(db, sync);
    const result = await query.entity("tmdb:movie:7001", owner, undefined, true);
    expect(result.coverage.state).toBe("missing");
    expect(await job("tmdb:movie:7001")).toBeUndefined();
  });
  it("warms several titles in one read and queues missing ones behind real requests", async () => {
    const sync = createSync(db, fixtureUpstream),
      query = createQueries(db, sync);
    const results = await query.titles(
      ["tmdb:movie:550", "tmdb:movie:7002", "tmdb:movie:7002"],
      owner,
    );
    expect(results.map((r) => r.id)).toEqual(["entity:tmdb:movie:550", "entity:tmdb:movie:7002"]);
    expect(results[0]!.coverage.state).toBe("complete");
    expect(results[1]!.coverage.state).toBe("missing");
    const queued = (await job("tmdb:movie:7002"))!;
    expect(queued.runAt.getTime()).toBeGreaterThan(Date.now() + 500);
    // Opening the title promotes the same job instead of queueing a second one.
    await sync.hydrate("tmdb:movie:7002");
    const promoted = (await job("tmdb:movie:7002"))!;
    expect(promoted.runAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(
      await db.select().from(schema.jobs).where(eq(schema.jobs.id, "entity:tmdb:movie:7002")),
    ).toHaveLength(1);
  });
  it("completes a cold title inside the request that asked for it", async () => {
    const sync = createSync(db, fixtureUpstream),
      query = createQueries(db, sync);
    sync.start();
    try {
      const started = Date.now();
      const result = await query.entity("tmdb:movie:7003", owner);
      expect(result.coverage.state).toBe("complete");
      expect(result.entities.some((e) => e.id === "tmdb:movie:7003")).toBe(true);
      expect(Date.now() - started).toBeLessThan(2400);
    } finally {
      sync.stop();
    }
  });
  it("hydrates a high-confidence prediction and returns its complete graph", async () => {
    const sync = createSync(db, fixtureUpstream),
      query = createQueries(db, sync);
    sync.start();
    try {
      const result = await query.entity("tmdb:person:7020", owner, undefined, true, true);
      expect(result.coverage.state).toBe("complete");
      expect(
        result.entities.find((e) => e.id === "tmdb:person:7020")?.data.relations,
      ).toBeDefined();
      expect(result.entities.some((e) => e.kind === "credit")).toBe(true);
    } finally {
      sync.stop();
    }
  });
  it("waits for authoritative discovery coverage when preparing a route", async () => {
    const sync = createSync(db, fixtureUpstream),
      query = createQueries(db, sync),
      params = feedParams.parse({ type: "movie", seed: "ready-route-coverage" });
    sync.start();
    try {
      const result = await query.discover(params, owner, undefined, true);
      expect(result.coverage.state).toBe("complete");
      expect(result.ids).toHaveLength(12);
      await db
        .update(schema.queryCache)
        .set({ error: "Catalog synchronization failed" })
        .where(eq(schema.queryCache.id, result.id));
      const cached = await query.discover(params, owner, undefined, true);
      expect(cached.coverage.state).toBe("error");
      expect(cached.coverage.complete).toBe(true);
      expect(cached.ids).toEqual(result.ids);
    } finally {
      sync.stop();
    }
  });
  it("serves batches over the API", async () => {
    const cookie = (await register("batcher")).cookie;
    const res = await service.app.request("/api/titles?ids=tmdb:movie:550,tmdb:tv:1399", {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).results).toHaveLength(2);
    const bad = await service.app.request(
      `/api/titles?ids=${Array.from({ length: 9 }, (_, i) => `tmdb:movie:${i + 1}`).join(",")}`,
      { headers: { Cookie: cookie } },
    );
    expect(bad.status).toBe(400);
  });
});

describe("first-screen graph inclusion and scheduling", () => {
  it("bundles bounded cached neighbours without fetching their neighbours or other users' state", async () => {
    await db.transaction(async (tx) => {
      await store.ingest(
        tx,
        "tmdb:person:819",
        {
          id: 819,
          name: "Edward Norton",
          biography: "Cached biography",
          profile_path: "/cached-person.jpg",
          combined_credits: {
            cast: Array.from({ length: 80 }, (_, i) => ({
              id: 80000 + i,
              title: `Cached film ${i}`,
              media_type: "movie",
              credit_id: `cached-role-${i}`,
            })),
          },
        },
        "detail",
      );
      await store.ingest(
        tx,
        "tmdb:movie:680",
        { ...movieDetail, id: 680, title: "Pulp Fiction" },
        "detail",
      );
    });
    const upstream = vi.fn(fixtureUpstream);
    const sync = createSync(db, upstream);
    try {
      const result = await createQueries(db, sync).entity("tmdb:movie:550", owner);
      expect(result.coverage.state).toBe("complete");
      expect(result.included?.map((graph) => graph.id)).toContain("entity:tmdb:person:819");
      expect(result.included?.every((graph) => graph.coverage.projection === "viewport")).toBe(
        true,
      );
      const person = result.entities.find((entity) => entity.id === "tmdb:person:819")!;
      expect(person.overview).toBe("Cached biography");
      expect(person.poster).toBe("/cached-person.jpg");
      expect(person.data.graphScope).toBe("viewport");
      expect((person.data.relations as Record<string, string[]>).filmography).toHaveLength(24);
      expect(result.entities.some((entity) => entity.id === "tmdb:movie:80079")).toBe(false);
      // The root's complete graph must survive a cycle through a neighbouring movie.
      expect(
        result.entities.find((entity) => entity.id === "tmdb:movie:550")?.data.graphScope,
      ).toBeUndefined();
      expect(
        result.entities
          .filter((entity) => entity.kind === "status")
          .every((entity) => entity.data.userId === owner),
      ).toBe(true);
      expect(upstream).not.toHaveBeenCalled();
      expect(new Set(result.entities.map((entity) => `${entity.kind}:${entity.id}`)).size).toBe(
        result.entities.length,
      );
    } finally {
      sync.stop();
    }
  });
  it("serves foreground hydration ahead of due speculation and drains without poll gaps", async () => {
    await db.delete(schema.jobs);
    const calls: string[] = [];
    const sync = createSync(db, async (path, params) => {
      calls.push(path);
      return fixtureUpstream(path, params);
    });
    await sync.hydrate("tmdb:movie:89001", 1000);
    await db
      .update(schema.jobs)
      .set({ runAt: new Date(Date.now() - 10000) })
      .where(eq(schema.jobs.id, "entity:tmdb:movie:89001"));
    await sync.hydrate("tmdb:movie:89002");
    const started = Date.now();
    sync.start();
    try {
      await vi.waitFor(
        async () => {
          const jobs = await db.select().from(schema.jobs);
          expect(jobs.filter((job) => job.state === "done")).toHaveLength(2);
        },
        { timeout: 3000, interval: 10 },
      );
      expect(calls).toEqual(["movie/89002", "movie/89001"]);
      expect(Date.now() - started).toBeLessThan(700);
    } finally {
      sync.stop();
    }
  });
  it("promotes interests without bypassing a retry deadline", async () => {
    const sync = createSync(db, fixtureUpstream);
    const runAt = new Date(Date.now() + 60000);
    try {
      await db.insert(schema.jobs).values({
        id: "entity:tmdb:movie:89003",
        kind: "entity",
        params: { id: "tmdb:movie:89003", priority: 0 },
        runAt,
        attempts: 2,
        state: "pending",
      });
      await sync.hydrate("tmdb:movie:89003");
      const [job] = await db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, "entity:tmdb:movie:89003"));
      expect(job?.runAt.getTime()).toBe(runAt.getTime());
      expect(job?.params.priority).toBe(2);
      expect(job?.attempts).toBe(2);
    } finally {
      sync.stop();
    }
  });
});

it("wakes for each delayed hydration deadline instead of missing later interests", async () => {
  await db.delete(schema.jobs);
  const sync = createSync(db, fixtureUpstream);
  await sync.hydrate("tmdb:movie:89004", 80);
  await sync.hydrate("tmdb:movie:89005", 220);
  const started = Date.now();
  sync.start();
  try {
    await vi.waitFor(
      async () => {
        const jobs = await db.select().from(schema.jobs);
        expect(jobs.filter((job) => job.state === "done")).toHaveLength(2);
      },
      { timeout: 3000, interval: 10 },
    );
    expect(Date.now() - started).toBeLessThan(700);
  } finally {
    sync.stop();
  }
});

it("keeps cache-only partial source rows as summaries rather than declaring their graph loaded", async () => {
  await db.transaction((tx) => store.ingest(tx, "tmdb:movie:89006", { ...movie, id: 89006 }));
  const sync = createSync(db, fixtureUpstream);
  try {
    const result = await createQueries(db, sync).entity("tmdb:movie:89006", owner, undefined, true);
    expect(result.coverage.state).toBe("partial");
    const root = result.entities.find((entity) => entity.id === "tmdb:movie:89006")!;
    expect(root.data.summary).toBe(true);
    expect(root.data.graphVersion).toBeUndefined();
    expect(root.related).toBeUndefined();
    expect(result.included).toBeUndefined();
  } finally {
    sync.stop();
  }
});
