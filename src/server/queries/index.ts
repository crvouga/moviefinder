import { supportsGenres } from "../../shared/genres";
import { rowEntity } from "../state";
import { and, eq, inArray, ilike, desc } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db";
import { sources, queryCache, statuses, items } from "../db/schema";
import { digest } from "../entity-store";
import { normalize as normalizeSource, summaryOf } from "../entity-store/normalize";
import type { Sync } from "../entity-store-sync";
import {
  feedParams,
  sourceId,
  stableSerialize,
  fieldText,
  type FeedParams,
  type Entity,
  type Coverage,
  type QueryResult,
} from "../../shared/contracts";
import { localMatch } from "../../shared/filters";
export { localMatch } from "../../shared/filters";
import { metrics } from "../log";
import { detailTargets, viewportGraph } from "../../shared/detail-graph";
import { timed, record } from "../telemetry";
export function defineQuery<P, C, R>(definition: {
  name: string;
  params: z.ZodType<P>;
  readCache: (params: P, signal?: AbortSignal) => Promise<C>;
  loadCache: (params: P, cache: C, signal?: AbortSignal) => Promise<void>;
  normalize: (cache: C, params: P) => R;
}) {
  return {
    ...definition,
    async execute(input: unknown, signal?: AbortSignal): Promise<R> {
      const start = performance.now(),
        params = definition.params.parse(input);
      signal?.throwIfAborted();
      const cached = await definition.readCache(params, signal);
      signal?.throwIfAborted();
      await definition.loadCache(params, cached, signal);
      const result = definition.normalize(cached, params);
      metrics.queries++;
      metrics.queryMilliseconds += performance.now() - start;
      return result;
    },
  };
}
const cursorSchema = z.object({ page: z.number().int().min(1).max(500), key: z.string() });
export function queryIdentity(p: FeedParams) {
  const { cursor: _, exclude: __, ...identity } = p;
  return digest(stableSerialize(identity));
}
export function decodeCursor(p: FeedParams) {
  if (!p.cursor) return 1;
  try {
    const c = cursorSchema.parse(JSON.parse(Buffer.from(p.cursor, "base64url").toString()));
    if (c.key !== queryIdentity(p)) throw new Error();
    return c.page;
  } catch {
    throw new Error("Invalid cursor for these feed filters");
  }
}
export function encodeCursor(p: FeedParams, page: number) {
  return Buffer.from(JSON.stringify({ page, key: queryIdentity(p) })).toString("base64url");
}
export function createQueries(db: Database, sync: Sync) {
  const discovery = (userId: string) =>
    defineQuery({
      name: "discover",
      params: feedParams,
      async readCache(p) {
        const page = decodeCursor(p),
          id = `discover:${queryIdentity(p)}:${page}`;
        const [cached] = await db.select().from(queryCache).where(eq(queryCache.id, id));
        let ids = cached?.ids ?? [];
        if (!cached) {
          metrics.cacheMiss++;
          const rows = await db
            .select({ id: sources.id })
            .from(sources)
            .where(
              and(
                p.type === "both"
                  ? inArray(sources.entityType, p.q ? ["movie", "tv", "person"] : ["movie", "tv"])
                  : eq(sources.entityType, p.type),
                p.q ? ilike(sources.title, `%${p.q.replace(/[%_\\]/g, "\\$&")}%`) : undefined,
              ),
            )
            .orderBy(desc(sources.popularity))
            .limit(40);
          ids = rows.map((r) => r.id);
        } else metrics.cacheHit++;
        const records = ids.length
          ? await db.select().from(sources).where(inArray(sources.id, ids))
          : [];
        const tags = ids.length
          ? await db
              .select()
              .from(statuses)
              .where(and(eq(statuses.userId, userId), inArray(statuses.titleId, ids)))
          : [];
        const membership =
          ids.length && (p.list || p.notInList)
            ? await db.select().from(items).where(inArray(items.titleId, ids))
            : [];
        const preferences =
          p.sort === "relevance"
            ? await db
                .select({ genres: sources.genres, sentiment: statuses.sentiment })
                .from(statuses)
                .innerJoin(sources, eq(sources.id, statuses.titleId))
                .where(
                  and(
                    eq(statuses.userId, userId),
                    inArray(statuses.sentiment, ["liked", "disliked"]),
                  ),
                )
                .limit(500)
            : [];
        return { id, page, cached, records, ids, tags, membership, preferences };
      },
      async loadCache(p, cache) {
        if (!cache.cached)
          await db
            .insert(queryCache)
            .values({ id: cache.id, name: "discover", params: JSON.parse(stableSerialize(p)) })
            .onConflictDoNothing();
        if (
          !cache.cached?.complete ||
          !cache.cached.refreshAt ||
          cache.cached.refreshAt.getTime() < Date.now()
        )
          await sync.enqueue(cache.id, "query", { queryId: cache.id, params: p, page: cache.page });
      },
      normalize(cache, p): QueryResult {
        const entities = cache.records.flatMap((r) => normalizeSource(r.id, r.payload, r.version)),
          byId = new Map<string, Entity>();
        for (const e of entities) {
          const old = byId.get(e.id);
          if (!old || e.version >= old.version) byId.set(e.id, e);
        }
        const statusMap = new Map(cache.tags.map((t) => [t.titleId, t]));
        let visible = cache.ids
          .map((id) => byId.get(id))
          .filter((e): e is Entity => !!e)
          .filter((e) =>
            localMatch(
              e,
              p,
              statusMap.get(e.id),
              new Set(cache.membership.filter((i) => i.titleId === e.id).map((i) => i.listId)),
              !!cache.cached?.complete &&
                !p.q &&
                p.sort !== "trending" &&
                (e.kind === "movie" || (!p.cast.length && !p.crew.length)),
            ),
          );
        const weights = new Map<string, number>();
        for (const pref of cache.preferences)
          for (const genre of pref.genres) {
            const id = `tmdb:genre:${genre}`;
            weights.set(id, (weights.get(id) ?? 0) + (pref.sentiment === "liked" ? 1 : -1));
          }
        const relevance = (e: Entity) =>
          (e.genres ?? []).reduce((sum, g) => sum + (weights.get(g) ?? 0), 0) +
          Math.log1p(e.popularity ?? 0) * 0.05;
        if (p.sort === "random")
          visible.sort((a, b) => digest(p.seed + a.id).localeCompare(digest(p.seed + b.id)));
        else if (p.sort === "relevance" && weights.size)
          visible.sort((a, b) => relevance(b) - relevance(a) || a.id.localeCompare(b.id));
        else if (p.sort === "rating" || p.sort === "lowest")
          visible.sort(
            (a, b) =>
              (p.sort === "rating" ? -1 : 1) * ((a.rating ?? 0) - (b.rating ?? 0)) ||
              a.id.localeCompare(b.id),
          );
        else if (p.sort === "newest" || p.sort === "oldest")
          visible.sort(
            (a, b) =>
              (p.sort === "newest" ? -1 : 1) *
                fieldText(a.data.releaseDate).localeCompare(fieldText(b.data.releaseDate)) ||
              a.id.localeCompare(b.id),
          );
        else if (p.sort !== "trending")
          visible.sort(
            (a, b) => (b.popularity ?? 0) - (a.popularity ?? 0) || a.id.localeCompare(b.id),
          );
        const cached = cache.cached,
          stale = !!cached?.refreshAt && cached.refreshAt.getTime() < Date.now();
        const coverage: Coverage = {
          complete: cached?.complete === true,
          state: cached?.error
            ? "error"
            : !cached
              ? "missing"
              : !cached.complete
                ? "partial"
                : stale
                  ? "stale"
                  : "complete",
          fetchedAt: cached?.fetchedAt?.toISOString() ?? null,
          nextCursor: cached?.nextPage ? encodeCursor(p, cached.nextPage) : null,
          unsupported: [],
          ...(cached?.error ? { message: cached.error } : {}),
        };
        if (
          (p.type === "both" && !supportsGenres("movie", p.genres)) ||
          (p.type !== "movie" && !supportsGenres("tv", p.genres))
        )
          coverage.unsupported.push(
            "Movie and TV genre categories differ. This combination only includes title types that support every selected genre.",
          );
        if (p.type !== "movie" && (p.cast.length || p.crew.length))
          coverage.unsupported.push(
            "To filter by cast or crew, switch to Movies. TV matches use the credits we’ve already found.",
          );
        if (p.sort === "relevance" && !weights.size)
          coverage.unsupported.push(
            "Leave a few likes and dislikes to personalize this feed. Popularity is used until then.",
          );
        if (
          (p.q || p.sort === "trending") &&
          (p.runtimeMin ||
            p.runtimeMax ||
            p.country ||
            p.cast.length ||
            p.crew.length ||
            p.providers.length)
        )
          coverage.unsupported.push(
            "Some titles don’t have enough detail to match every filter. Try Popular now for more complete results.",
          );
        return {
          id: cache.id,
          // Feeds carry each title once, as a summary; the detail view loads the rest.
          entities: [
            ...cache.ids.flatMap((id) => {
              const r = cache.records.find((x) => x.id === id);
              return r ? summaryOf(r.id, r.payload, r.version) : [];
            }),
            ...cache.tags.map((row) => rowEntity("status", row)),
          ],
          ids: visible.map((e) => e.id),
          coverage,
        };
      },
    });
  // Everything a title screen needs from one cached row.
  function titleResult(
    id: string,
    row: typeof sources.$inferSelect | undefined,
    tags: (typeof statuses.$inferSelect)[],
  ): QueryResult {
    return {
      id: `entity:${id}`,
      entities: [
        ...(row
          ? row.projection === "detail"
            ? normalizeSource(id, row.payload, row.version)
            : summaryOf(id, row.payload, row.version)
          : []),
        ...tags.map((tag) => rowEntity("status", tag)),
      ],
      ids: row ? [id] : [],
      coverage: {
        state: !row
          ? "missing"
          : row.projection !== "detail"
            ? "partial"
            : row.refreshAt.getTime() < Date.now()
              ? "stale"
              : "complete",
        fetchedAt: row?.fetchedAt.toISOString() ?? null,
        nextCursor: null,
        unsupported: [],
        ...(row?.error ? { message: row.error } : {}),
      },
    };
  }
  const needsDetail = (row: typeof sources.$inferSelect | undefined) =>
    !row || row.projection !== "detail";
  // How long a request may wait for a cold title's hydration before events finish the job.
  const hydrationWait = 2500;
  // Cache-only hints start no provider work. A ready prediction hydrates behind foreground
  // jobs and waits for its complete graph; the client bounds these high-confidence interests.
  const entity = (userId: string, warm = false, ready = false) =>
    defineQuery({
      name: "entity",
      params: sourceId,
      async readCache(id) {
        const [row] = await db.select().from(sources).where(eq(sources.id, id));
        const tags = await db
          .select()
          .from(statuses)
          .where(and(eq(statuses.userId, userId), eq(statuses.titleId, id)));
        return { row, tags };
      },
      async loadCache(id, cache, signal) {
        const { row } = cache;
        if (warm && !ready) return;
        if (!row || row.projection !== "detail" || row.refreshAt.getTime() < Date.now()) {
          await sync.hydrate(id, warm ? 200 : 0);
          // A cold title usually finishes within the provider's round trip, so answer with it
          // here instead of making the browser wait for an event and ask again.
          if (needsDetail(row) && (await sync.settled(id, ready ? 10_000 : hydrationWait, signal)))
            [cache.row] = await db.select().from(sources).where(eq(sources.id, id));
        }
      },
      normalize({ row, tags }, id): QueryResult {
        return titleResult(id, row, tags);
      },
    });
  // Several titles in one round trip, for warming what a person is likely to open next. Missing
  // details are requested at low priority and arrive by event; nobody waits for them here.
  async function titles(ids: string[], userId: string) {
    const unique = [...new Set(ids)];
    const rows = new Map(
      (await db.select().from(sources).where(inArray(sources.id, unique))).map((row) => [
        row.id,
        row,
      ]),
    );
    await Promise.all(
      unique.filter((id) => needsDetail(rows.get(id))).map((id) => sync.hydrate(id, 1000)),
    );
    const tags = await db
      .select()
      .from(statuses)
      .where(and(eq(statuses.userId, userId), inArray(statuses.titleId, unique)));
    metrics.queries++;
    return unique.map((id) =>
      titleResult(
        id,
        rows.get(id),
        tags.filter((tag) => tag.titleId === id),
      ),
    );
  }
  async function includeCachedGraph(result: QueryResult): Promise<QueryResult> {
    const primary = result.entities.find((entity) => entity.id === result.ids[0]);
    if (!primary) return result;
    const entities = new Map(result.entities.map((entity) => [entity.id, entity]));
    const targets = detailTargets(primary, (id) => entities.get(id));
    const ids = [...new Set([...targets.people, ...targets.titles])].filter(
      (id) => id !== primary.id,
    );
    if (!ids.length) return result;
    return timed("graph", "cache", async () => {
      // One read for all visible neighbours. No provider work and no recursive traversal.
      const rows = new Map(
        (await db.select().from(sources).where(inArray(sources.id, ids))).map((row) => [
          row.id,
          row,
        ]),
      );
      // Match the two-destination prediction budget; prefer cached visible people, then titles.
      const previews = new Set(
        [...targets.people, ...targets.titles]
          .filter((id) => rows.get(id)?.projection === "detail")
          .slice(0, 2),
      );
      const included: NonNullable<QueryResult["included"]> = [];
      for (const id of ids) {
        const row = rows.get(id);
        if (!row) continue;
        const full = previews.has(id) && row.projection === "detail";
        const graph = full
          ? viewportGraph(normalizeSource(id, row.payload, row.version), id)
          : summaryOf(id, row.payload, row.version);
        for (const entity of graph) {
          const held = entities.get(entity.id);
          if (entity.id !== primary.id && (!held || entity.version > held.version))
            entities.set(entity.id, entity);
        }
        if (full)
          included.push({
            id: `entity:${id}`,
            ids: [id],
            coverage: {
              state: row.refreshAt.getTime() < Date.now() ? "stale" : "complete",
              fetchedAt: row.fetchedAt.toISOString(),
              nextCursor: null,
              unsupported: [],
              projection: "viewport",
            },
          });
      }
      record("graph", "size", { entities: entities.size, count: included.length });
      return { ...result, entities: [...entities.values()], included };
    });
  }
  // Registered definitions retain distinct cache, scheduling, and projection responsibilities.
  const definitions = { discover: discovery, entity };
  return {
    definitions,
    discover: async (input: unknown, userId: string, signal?: AbortSignal, ready = false) => {
      const query = definitions.discover(userId);
      const result = await query.execute(input, signal);
      if (
        ready &&
        ["missing", "partial"].includes(result.coverage.state) &&
        (await sync.settledJob(result.id, 10_000, signal))
      )
        return query.execute(input, signal);
      return result;
    },
    entity: async (
      id: string,
      userId: string,
      signal?: AbortSignal,
      warm = false,
      ready = false,
    ) => {
      const result = await definitions.entity(userId, warm, ready).execute(id, signal);
      signal?.throwIfAborted();
      return includeCachedGraph(result);
    },
    titles,
  };
}
