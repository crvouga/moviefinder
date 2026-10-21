import { describe, it, expect, vi } from "vite-plus/test";
import fc from "fast-check";
import { generateKeyBetween } from "fractional-indexing";
import {
  canonicalId,
  feedParams,
  stableSerialize,
  canEdit,
  canManage,
  safeReturnTo,
  mergeEvent,
  type Entity,
  type EventEnvelope,
} from "../../src/shared/contracts";
import { normalize } from "../../src/server/entity-store/normalize";
import { queryIdentity, encodeCursor, decodeCursor, localMatch } from "../../src/server/queries";
import { upstreamParameters } from "../../src/server/entity-store-sync";
import { createTmdb } from "../../src/server/entity-store-sync/tmdb";
import { movieDetail } from "../fixtures/catalog";
import { createSync } from "../../src/server/entity-store-sync";
import type { Database } from "../../src/server/db";
import {
  databaseFailure,
  databaseStartupMessage,
  DatabaseNotReady,
} from "../../src/server/db/readiness";
describe("canonical catalog", () => {
  it("separates movie and series identities", () =>
    expect(canonicalId("movie", 1)).not.toBe(canonicalId("tv", 1)));
  it("normalizes credits and recommendations into navigable canonical references", () => {
    const rows = normalize("tmdb:movie:550", movieDetail, 4),
      movie = rows.find((e) => e.id === "tmdb:movie:550")!;
    expect(movie.version).toBe(4);
    expect(movie.genres).toContain("tmdb:genre:18");
    expect(rows.find((e) => e.id === "tmdb:person:819")?.title).toBe("Edward Norton");
    expect(rows.find((e) => e.kind === "credit")?.data.titleId).toBe(movie.id);
    expect(movie.related).toContain("tmdb:movie:680");
  });
  it("tolerates missing, nullable, and unknown upstream values deterministically", () =>
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(normalize("tmdb:tv:1", value)).toEqual(normalize("tmdb:tv:1", value));
        expect(normalize("tmdb:tv:1", value).some((e) => e.id === "tmdb:tv:1")).toBe(true);
      }),
      { numRuns: 150 },
    ));
  it("uses canonical season and episode ancestry", () => {
    expect(
      normalize("tmdb:tv:4", { seasons: [{ id: 2, season_number: 1, name: "Season 1" }] })[0]?.id,
    ).toBe("tmdb:tv:4:season:1");
    expect(
      normalize("tmdb:tv:4:season:1", {
        episodes: [{ id: 2, episode_number: 3, name: "Episode" }],
      })[0]?.id,
    ).toBe("tmdb:tv:4:season:1:episode:3");
  });
});
describe("query contracts", () => {
  it("serializes object keys canonically", () =>
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (value) => {
        expect(stableSerialize(value)).toBe(
          stableSerialize(Object.fromEntries(Object.entries(value).reverse())),
        );
      }),
    ));
  it("validates compound filters and reversed ranges", () => {
    expect(feedParams.parse({ genres: "18,35", ratingMin: "7", seen: "unseen" })).toMatchObject({
      genres: [18, 35],
      ratingMin: 7,
      seen: "unseen",
    });
    expect(feedParams.safeParse({ yearMin: 2025, yearMax: 1990 }).success).toBe(false);
    expect(feedParams.safeParse({ genres: "abc" }).success).toBe(false);
  });
  it("ties cursors to the filter identity", () => {
    const p = feedParams.parse({ genres: [18] });
    expect(decodeCursor({ ...p, cursor: encodeCursor(p, 2) })).toBe(2);
    expect(() => decodeCursor({ ...p, genres: [35], cursor: encodeCursor(p, 2) })).toThrow();
    expect(queryIdentity(p)).toBe(queryIdentity({ ...p, exclude: ["tmdb:movie:1"] }));
  });
  it("composes provider filters instead of silently replacing them", () => {
    const p = upstreamParameters(
      feedParams.parse({
        genres: [18, 35],
        ratingMin: 7,
        yearMin: 1990,
        yearMax: 2020,
        runtimeMax: 120,
        providers: [8],
      }),
      2,
      "movie",
    );
    expect(p).toMatchObject({
      with_genres: "18,35",
      "vote_average.gte": "7",
      "primary_release_date.gte": "1990-01-01",
      "primary_release_date.lte": "2020-12-31",
      "with_runtime.lte": "120",
      with_watch_providers: "8",
      page: "2",
    });
  });
  it("keeps viewing and sentiment independent", () => {
    const e = normalize("tmdb:movie:550", movieDetail).find((e) => e.id === "tmdb:movie:550")!;
    expect(
      localMatch(e, feedParams.parse({ seen: "unseen", sentiment: "liked" }), {
        seen: false,
        sentiment: "liked",
      } as never),
    ).toBe(true);
    expect(
      localMatch(e, feedParams.parse({ seen: "seen" }), {
        seen: false,
        sentiment: "liked",
      } as never),
    ).toBe(false);
  });
});
describe("permissions, ordering, and replay", () => {
  it("separates content editing from collaborator management", () => {
    expect(canEdit("editor")).toBe(true);
    expect(canManage("editor")).toBe(false);
    expect(canEdit(undefined)).toBe(false);
    expect(canManage("owner")).toBe(true);
  });
  it("rejects open redirect targets", () => {
    for (const v of ["https://evil.test", "//evil.test", "/\\evil.test", "/auth", "/\n//evil.test"])
      expect(safeReturnTo(v)).toBe("/");
    expect(safeReturnTo("/title/tmdb%3Amovie%3A1?x=2")).toContain("/title/");
  });
  it("generates dense sortable keys without rewriting existing entries", () =>
    fc.assert(
      fc.property(fc.array(fc.nat(), { maxLength: 200 }), (positions) => {
        const keys: string[] = [];
        for (const position of positions) {
          const i = position % (keys.length + 1),
            key = generateKeyBetween(keys[i - 1] ?? null, keys[i] ?? null);
          keys.splice(i, 0, key);
          expect([...keys].sort()).toEqual(keys);
          expect(new Set(keys).size).toBe(keys.length);
        }
      }),
      { numRuns: 50 },
    ));
  it("rejects duplicate and out-of-order entity revisions", () => {
    const versions = new Map<string, number>(),
      e: Entity = { id: "a", kind: "list", version: 2, title: "New", data: {} },
      event: EventEnvelope = {
        protocol: 1,
        id: "1",
        type: "upsert",
        subscription: "list:a",
        entities: [e],
        removed: [],
        timestamp: "",
      };
    expect(mergeEvent(versions, event)).toEqual([e]);
    expect(mergeEvent(versions, event)).toEqual([]);
    expect(mergeEvent(versions, { ...event, entities: [{ ...e, version: 1 }] })).toEqual([]);
  });
});
describe("upstream boundary", () => {
  it("honors Retry-After without exposing credentials", async () => {
    const transport = async () =>
      new Response("{}", { status: 429, headers: { "Retry-After": "7" } });
    await expect(createTmdb("test-only", transport)("movie/1")).rejects.toMatchObject({
      status: 429,
      retryAfter: 7000,
    });
  });
  it("rejects malformed upstream documents", async () => {
    const transport = async () => Response.json("unexpected");
    await expect(createTmdb("test-only", transport)("movie/1")).rejects.toThrow();
  });
});

it("observes provider-wide cooldown after a rate-limit response", async () => {
  let calls = 0;
  const provider = createTmdb("test-only", async () => {
    calls++;
    return new Response("{}", { status: 429, headers: { "Retry-After": "60" } });
  });
  await expect(provider("movie/1")).rejects.toMatchObject({ status: 429 });
  await expect(provider("movie/2")).rejects.toMatchObject({ status: 429 });
  expect(calls).toBe(1);
});
it("accepts empty optional filter form fields without inventing constraints", () => {
  const result = feedParams.parse({
    language: "",
    country: "",
    dateMin: "",
    dateMax: "",
    runtimeMin: "",
    ratingMin: "8",
    genres: "",
  });
  expect(result.language).toBeUndefined();
  expect(result.country).toBeUndefined();
  expect(result.runtimeMin).toBeUndefined();
  expect(result.ratingMin).toBe(8);
});
it("round-trips numeric and compound filters through the router without quoted strings", async () => {
  const { parseSearch, stringifySearch } = await import("../../src/shared/search");
  const p = feedParams.parse({ ratingMin: 8, genres: [35, 18] });
  const next = feedParams.parse(parseSearch(stringifySearch({ ratingMin: "8", genres: p.genres })));
  expect(next.ratingMin).toBe(8);
  expect(next.genres).toEqual([18, 35]);
});
it("retains only validated per-user command intents for reload recovery", async () => {
  const { createOutbox } = await import("../../src/client/outbox");
  const data = new Map<string, string>(),
    outbox = createOutbox({
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => {
        data.set(k, v);
      },
      removeItem: (k) => {
        data.delete(k);
      },
    }),
    command = {
      type: "status",
      operationId: crypto.randomUUID(),
      titleId: "tmdb:movie:550",
      seen: true,
    } as const;
  outbox.put("a", command);
  outbox.put("a", command);
  expect(outbox.read("a")).toEqual([command]);
  expect(outbox.read("b")).toEqual([]);
  outbox.remove("a", command.operationId);
  expect(outbox.read("a")).toEqual([]);
});
it("keeps movie and TV genre taxonomies explicit rather than issuing unsupported provider filters", async () => {
  const { supportsGenres } = await import("../../src/shared/genres");
  expect(supportsGenres("movie", [28])).toBe(true);
  expect(supportsGenres("tv", [28])).toBe(false);
  expect(supportsGenres("tv", [10759, 18])).toBe(true);
});

it("does not invent rating or popularity for missing source metadata", () => {
  const value = normalize("tmdb:movie:1", { id: 1 })[0]!;
  expect(value.rating).toBeUndefined();
  expect(value.popularity).toBeUndefined();
});

it("restricts title-tag and list commands to movies and series", async () => {
  const { commandSchema } = await import("../../src/shared/contracts");
  expect(
    commandSchema.safeParse({
      type: "status",
      operationId: crypto.randomUUID(),
      titleId: "tmdb:person:819",
      seen: true,
    }).success,
  ).toBe(false);
});

describe("database failures", () => {
  it("distinguishes wrapped schema failures from transient connection errors", () => {
    expect(
      databaseFailure(
        new Error("Failed query with sensitive parameters", { cause: { code: "42P01" } }),
      ),
    ).toBe("schema");
    expect(databaseFailure({ code: "ECONNREFUSED" })).toBe("connection");
    expect(databaseFailure({ code: "42501" })).toBe("permissions");
    expect(databaseFailure({ code: "23505" })).toBeUndefined();
    expect(databaseStartupMessage(new DatabaseNotReady(["moviefinder.user.id"]))).toContain(
      "After allocation approval",
    );
    expect(databaseStartupMessage(new Error("postgres://do-not-log-this"))).not.toContain(
      "do-not-log-this",
    );
  });
  it("backs off transient failures, recovers normal polling, and cancels pending work on stop", async () => {
    vi.useFakeTimers();
    const output = vi.spyOn(console, "log").mockImplementation(() => {}),
      transaction = vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" }),
        ),
      worker = createSync(
        {
          transaction,
          select: () => ({
            from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }),
          }),
        } as unknown as Database,
        async () => ({}),
      );
    try {
      await worker.tick();
      expect(transaction).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(transaction).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1000);
      expect(transaction).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1000);
      expect(transaction).toHaveBeenCalledTimes(3);
      expect(output).toHaveBeenCalledTimes(1);
      transaction.mockResolvedValue([]);
      await vi.advanceTimersByTimeAsync(4000);
      expect(transaction).toHaveBeenCalledTimes(4);
      expect(JSON.stringify(output.mock.calls)).toContain("Database connection restored");
      await vi.advanceTimersByTimeAsync(800);
      expect(transaction).toHaveBeenCalledTimes(5);
      worker.stop();
      await vi.advanceTimersByTimeAsync(60000);
      expect(transaction).toHaveBeenCalledTimes(5);
    } finally {
      worker.stop();
      output.mockRestore();
      vi.useRealTimers();
    }
  });
});
