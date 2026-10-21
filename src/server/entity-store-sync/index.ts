import { timed, record, telemetryKey, forgetTelemetryKey, inTrace, background } from "../telemetry";
import { supportsGenres, movieGenreIds, tvGenreIds } from "../../shared/genres";
import { mergeDiscovery, supportsMerge } from "./discovery";
import { fieldText } from "../../shared/contracts";
import { eq, sql } from "drizzle-orm";
import type { Database } from "../db";
import { jobs, queryCache, sources, checkpoints } from "../db/schema";
import { createEntityStore } from "../entity-store";
import { kindFor } from "../entity-store/normalize";
import { canonicalId, type FeedParams } from "../../shared/contracts";
import { appendEvent } from "../events";
import { metrics, log } from "../log";
import { type Tmdb, UpstreamError, upstreamPage } from "./tmdb";
import { databaseFailure } from "../db/readiness";
export function upstreamParameters(p: FeedParams, page: number, type: "movie" | "tv") {
  const out: Record<string, string> = {
    page: fieldText(Math.min(page, 500)),
    include_adult: "false",
    language: "en-US",
  };
  const sort = {
    popularity: "popularity.desc",
    rating: "vote_average.desc",
    lowest: "vote_average.asc",
    newest: type === "movie" ? "primary_release_date.desc" : "first_air_date.desc",
    oldest: type === "movie" ? "primary_release_date.asc" : "first_air_date.asc",
    random: "popularity.desc",
    relevance: "popularity.desc",
    trending: "popularity.desc",
  };
  out.sort_by = sort[p.sort];
  const set = (k: string, v: unknown) => {
    if (v !== undefined && v !== "" && (!Array.isArray(v) || v.length))
      out[k] = Array.isArray(v) ? v.join(",") : fieldText(v);
  };
  set("with_genres", p.genres);
  set(
    "without_genres",
    p.excludeGenres.filter((id) => (type === "movie" ? movieGenreIds : tvGenreIds).includes(id)),
  );
  const date = type === "movie" ? "primary_release_date" : "first_air_date";
  set(`${date}.gte`, p.dateMin ?? (p.yearMin ? `${p.yearMin}-01-01` : undefined));
  set(`${date}.lte`, p.dateMax ?? (p.yearMax ? `${p.yearMax}-12-31` : undefined));
  for (const [k, v] of Object.entries({
    "with_runtime.gte": p.runtimeMin,
    "with_runtime.lte": p.runtimeMax,
    with_original_language: p.language,
    with_origin_country: p.country,
    "vote_average.gte": p.ratingMin,
    "vote_average.lte": p.ratingMax,
    "vote_count.gte": p.votesMin,
    with_cast: type === "movie" ? p.cast : [],
    with_crew: type === "movie" ? p.crew : [],
    with_keywords: p.keywords,
    with_watch_providers: p.providers,
    watch_region: p.providers.length ? p.region : undefined,
  }))
    set(k, v);
  return out;
}
export function createSync(db: Database, tmdb: Tmdb) {
  const store = createEntityStore(db);
  const request: Tmdb = async (path, params, signal) => {
    const [checkpoint] = await db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.id, "tmdb:rate-limit"));
    if (checkpoint && checkpoint.payload.resumeAt > Date.now())
      throw new UpstreamError(429, checkpoint.payload.resumeAt - Date.now());
    try {
      return await timed("upstream", `GET ${path}`, () => tmdb(path, params, signal));
    } catch (error) {
      if (error instanceof UpstreamError && error.status === 429) {
        const resumeAt = Date.now() + Math.max(1000, error.retryAfter);
        await db
          .insert(checkpoints)
          .values({ id: "tmdb:rate-limit", payload: { resumeAt } })
          .onConflictDoUpdate({
            target: checkpoints.id,
            set: {
              payload: sql`jsonb_build_object('resumeAt',greatest(coalesce((${checkpoints.payload}->>'resumeAt')::bigint,0),${resumeAt}::bigint))`,
              updatedAt: new Date(),
            },
          });
      }
      throw error;
    }
  };

  let stopped = false;
  let started = false;
  let ticking = false;
  let rerun = false;
  // Jobs finished by this process, so a request can wait for its own hydration instead of polling.
  const waiters = new Map<string, Set<() => void>>();
  const finished = (jobId: string) => {
    for (const wake of waiters.get(jobId) ?? []) wake();
    waiters.delete(jobId);
    forgetTelemetryKey(jobId);
  };
  let connectionFailures = 0;
  let lastDatabaseLog = -Infinity;
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delayedWake: ReturnType<typeof setTimeout> | undefined;
  let wakeAt = Infinity;
  // `delayMs` marks work nobody is waiting for. The provider lane is sequential and rate limited,
  // so a person skimming past titles must not queue ahead of the one they open; a request with no
  // delay promotes a job that is still waiting.
  async function enqueue(id: string, kind: string, params: Record<string, unknown>, delayMs = 0) {
    const due = new Date(Date.now() + delayMs);
    const priority = delayMs === 0 ? 2 : delayMs < 1000 ? 1 : 0;
    await db
      .insert(jobs)
      .values({ id, kind, params: { ...params, priority }, runAt: due })
      .onConflictDoUpdate({
        target: jobs.id,
        set: {
          state: sql`case when ${jobs.state} = 'done' or (${jobs.state} = 'failed' and ${jobs.runAt} <= now()) then 'pending' else ${jobs.state} end`,
          runAt: delayMs
            ? sql`case when ${jobs.state} = 'done' then ${due} else ${jobs.runAt} end`
            : sql`case when ${jobs.state} = 'done' then now() when ${jobs.state} = 'pending' and ${jobs.attempts} = 0 then least(${jobs.runAt}, now()) else ${jobs.runAt} end`,
          attempts: sql`case when ${jobs.state} = 'done' then 0 else ${jobs.attempts} end`,
          params: sql`${jobs.params} || jsonb_build_object('priority', case when ${jobs.state} = 'done' then ${priority} else greatest(coalesce((${jobs.params}->>'priority')::int, 0), ${priority}) end)`,
        },
      });
    record("job", "enqueue", { workId: telemetryKey(id), delayMs });
    if (!delayMs) kick();
    else if (started && !stopped && due.getTime() < wakeAt) {
      clearTimeout(delayedWake);
      wakeAt = due.getTime();
      delayedWake = setTimeout(
        () => {
          wakeAt = Infinity;
          delayedWake = undefined;
          kick();
        },
        Math.max(0, wakeAt - Date.now()),
      );
    }
  }
  async function hydrate(id: string, delayMs = 0) {
    return enqueue(`entity:${id}`, "entity", { id }, delayMs);
  }
  // Resolves true when the title's hydration job finishes (or already had), false on timeout or
  // when no worker runs in this process. Callers fall back to events in that case.
  const settledJob = (jobId: string, timeoutMs: number, signal?: AbortSignal) => {
    const workId = telemetryKey(jobId);
    return timed("job-wait", "settled", () => waitForJob(jobId, timeoutMs, signal), {
      workId,
      timeoutMs,
    }).then((done) => {
      record("job-wait", "outcome", {
        workId,
        outcome: done ? "success" : !started || stopped ? "cancelled" : "timeout",
      });
      return done;
    });
  };
  async function waitForJob(jobId: string, timeoutMs: number, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!started || stopped) return false;
    let wake!: () => void;
    const done = new Promise<boolean>((resolve) => {
      wake = () => resolve(true);
    });
    const set = waiters.get(jobId) ?? new Set();
    set.add(wake);
    waiters.set(jobId, set);
    try {
      const [job] = await db.select({ state: jobs.state }).from(jobs).where(eq(jobs.id, jobId));
      if (!job || job.state === "done" || job.state === "failed") return true;
      return await new Promise<boolean>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abortNow);
        };
        const timer = setTimeout(() => {
          cleanup();
          resolve(false);
        }, timeoutMs);
        const abortNow = () => {
          cleanup();
          reject(signal!.reason);
        };
        signal?.addEventListener("abort", abortNow, { once: true });
        if (signal?.aborted) abortNow();
        void done.then((value) => {
          cleanup();
          resolve(value);
        });
      });
    } finally {
      set.delete(wake);
      if (!set.size && waiters.get(jobId) === set) waiters.delete(jobId);
    }
  }
  const settled = (id: string, timeoutMs: number, signal?: AbortSignal) =>
    settledJob(`entity:${id}`, timeoutMs, signal);
  // New work should not wait for the next poll.
  function kick() {
    if (!started || stopped) return;
    if (ticking) {
      rerun = true;
      return;
    }
    if (timer) clearTimeout(timer);
    void background(tick);
  }
  async function runJob(job: typeof jobs.$inferSelect) {
    if (job.kind === "entity") {
      const id = fieldText(job.params.id),
        parts = id.split(":"),
        type = kindFor(id),
        path =
          parts[1] === "tv"
            ? `tv/${parts[2]}${parts[3] ? `/season/${parts[4]}` : ""}${parts[5] ? `/episode/${parts[6]}` : ""}`
            : `${parts[1]}/${parts[2]}`;
      const append =
        type === "person"
          ? "combined_credits,external_ids,images"
          : type === "season" || type === "episode"
            ? "credits,external_ids,videos"
            : type === "movie"
              ? "credits,recommendations,similar,external_ids,videos,keywords,watch/providers,release_dates"
              : "aggregate_credits,recommendations,similar,external_ids,videos,keywords,watch/providers,content_ratings";
      const payload = await request(path, { append_to_response: append }, abort.signal);
      await db.transaction(async (tx) => {
        await store.ingest(tx, id, payload, "detail");
        await tx
          .update(jobs)
          .set({ state: "done", leaseUntil: null, error: null })
          .where(eq(jobs.id, job.id));
      });
    } else {
      const p = job.params.params as FeedParams,
        page = Number(job.params.page),
        qid = fieldText(job.params.queryId),
        types = p.type === "both" ? (["movie", "tv"] as const) : [p.type];
      const ids: string[] = [];
      let hasNext = false;
      let providerState: Record<string, unknown> | undefined;
      if (supportsMerge(p)) {
        const merged = await mergeDiscovery(
          db,
          request,
          p,
          page,
          qid,
          upstreamParameters,
          abort.signal,
        );
        ids.push(...merged.ids);
        hasNext = merged.hasNext;
        providerState = merged.providerState;
      } else
        for (const type of types) {
          if (!p.q && p.sort !== "trending" && !supportsGenres(type, p.genres)) continue;
          const path = p.q
            ? "search/multi"
            : p.sort === "trending"
              ? `trending/${p.type === "both" ? "all" : type}/week`
              : `discover/${type}`;
          const payload = upstreamPage.parse(
            await request(
              path,
              p.q
                ? { query: p.q, page: fieldText(page), include_adult: "false" }
                : upstreamParameters(p, page, type),
              abort.signal,
            ),
          );
          await db.transaction(async (tx) => {
            for (const row of payload.results) {
              const actual =
                row.media_type === "tv"
                  ? "tv"
                  : row.media_type === "person"
                    ? "person"
                    : row.media_type === "movie"
                      ? "movie"
                      : type;
              if (p.q && p.type !== "both" && actual !== p.type && actual !== "person") continue;
              const id = canonicalId(actual, row.id);
              await store.ingest(tx, id, row);
              ids.push(id);
            }
            // Persist partial provider coverage before attempting the other media type.
            await tx
              .update(queryCache)
              .set({
                ids: [...new Set(ids)],
                complete: false,
                error: null,
                fetchedAt: new Date(),
                version: sql`${queryCache.version}+1`,
              })
              .where(eq(queryCache.id, qid));
            await appendEvent(tx, qid, [], [], null, "upsert");
          });
          hasNext ||= page < Math.min(payload.total_pages ?? page, 500);
          if (p.q || (p.sort === "trending" && p.type === "both")) break;
        }
      await db.transaction(async (tx) => {
        await tx
          .update(queryCache)
          .set({
            ids: [...new Set(ids)],
            complete: true,
            ...(providerState ? { params: { ...p, providerState } } : {}),
            nextPage: hasNext ? page + 1 : null,
            fetchedAt: new Date(),
            refreshAt: new Date(Date.now() + 3600000),
            error: null,
            version: sql`${queryCache.version}+1`,
          })
          .where(eq(queryCache.id, qid));
        await appendEvent(tx, qid, [], [], null, "complete");
        await tx
          .update(jobs)
          .set({ state: "done", leaseUntil: null, error: null })
          .where(eq(jobs.id, job.id));
      });
    }
  }
  async function tick() {
    if (stopped || ticking) return;
    ticking = true;
    try {
      await pollOnce();
    } finally {
      ticking = false;
      if (rerun && !stopped) {
        rerun = false;
        if (timer) clearTimeout(timer);
        void background(tick);
      }
    }
  }
  async function pollOnce() {
    let nextPoll = 800;
    try {
      const claimed = await db.transaction(async (tx) => {
        const result = await tx.execute(
          sql`select id from moviefinder.sync_job where (state='pending' and run_at <= now()) or (state='running' and lease_until < now()) order by coalesce((params->>'priority')::int, 0) desc, run_at limit 1 for update skip locked`,
        );
        const ids = result.rows.map((r) => fieldText(r.id));
        if (!ids.length) return [];
        return tx
          .update(jobs)
          .set({
            state: "running",
            leaseUntil: new Date(Date.now() + 120000),
            attempts: sql`${jobs.attempts}+1`,
            updatedAt: new Date(),
          })
          .where(
            sql`${jobs.id} in (${sql.join(
              ids.map((id) => sql`${id}`),
              sql`,`,
            )})`,
          )
          .returning();
      });
      if (connectionFailures) log("sync", "Database connection restored");
      connectionFailures = 0;
      // Drain due work without an idle 800 ms gap; re-select after each job so a click can
      // overtake queued speculation. Empty polls still back off and provider pacing is unchanged.
      if (claimed.length) nextPoll = 0;
      else {
        // A single earliest-wake timer cannot cover every delayed interest. Once that wake
        // has fired, schedule the next actual deadline rather than sleeping past it.
        const [next] = await db
          .select({ runAt: jobs.runAt })
          .from(jobs)
          .where(sql`${jobs.state} = 'pending' and ${jobs.runAt} > now()`)
          .orderBy(jobs.runAt)
          .limit(1);
        if (next) nextPoll = Math.min(nextPoll, Math.max(1, next.runAt.getTime() - Date.now()));
      }
      // A bounded, sequential upstream lane makes rate limiting predictable.
      for (const job of claimed) {
        try {
          await inTrace({ traceId: crypto.randomUUID() }, () =>
            timed("job", "run", () => runJob(job), {
              workId: telemetryKey(job.id),
              queueMs: Math.max(0, Date.now() - job.runAt.getTime()),
              attempt: job.attempts,
            }),
          );
          metrics.syncSuccess++;
          finished(job.id);
        } catch (error) {
          if (stopped) break;
          metrics.syncFailure++;
          const fatal =
            error instanceof UpstreamError && [400, 401, 403, 404, 422].includes(error.status);
          const retry =
            Math.max(
              error instanceof UpstreamError ? error.retryAfter : 0,
              Math.min(3600000, 1000 * 2 ** Math.min(job.attempts, 12)),
            ) +
            Math.random() * 500;
          const message =
            error instanceof UpstreamError ? error.message : "Catalog synchronization failed";
          await db
            .update(jobs)
            .set({
              state: fatal || job.attempts >= 12 ? "failed" : "pending",
              leaseUntil: null,
              runAt: new Date(Date.now() + retry),
              error: message,
            })
            .where(eq(jobs.id, job.id));
          if (job.kind === "query")
            await db.transaction(async (tx) => {
              await tx
                .update(queryCache)
                .set({ error: message })
                .where(eq(queryCache.id, fieldText(job.params.queryId)));
              await appendEvent(tx, fieldText(job.params.queryId), [], [], null, "complete");
            });
          if (job.kind === "entity")
            await db
              .update(sources)
              .set({ lastFailure: new Date(), error: message })
              .where(eq(sources.id, fieldText(job.params.id)));
          record("job", "retry", {
            workId: telemetryKey(job.id),
            attempt: job.attempts,
            retryMs: retry,
            failed: fatal || job.attempts >= 12,
          });
          log("sync", message, { job: job.id, attempt: job.attempts });
          finished(job.id);
        }
      }
    } catch (error) {
      const reason = databaseFailure(error);
      if (reason !== "connection") {
        log(
          "sync",
          reason === "schema"
            ? "Catalog sync paused: database migrations are missing. Apply the configured database's migrations and restart MovieFinder."
            : reason === "permissions"
              ? "Catalog sync paused: check the allocated database credentials and schema grants, then restart MovieFinder."
              : "Catalog sync paused after an unexpected database error. Check configuration and restart MovieFinder.",
        );
        return;
      }
      connectionFailures++;
      nextPoll = Math.min(60000, 1000 * 2 ** Math.min(connectionFailures - 1, 6));
      if (Date.now() - lastDatabaseLog >= 60000) {
        log("sync", "Database unavailable; catalog sync will retry with backoff", {
          retryMilliseconds: nextPoll,
        });
        lastDatabaseLog = Date.now();
      }
    }
    if (!stopped) timer = setTimeout(() => void background(tick), nextPoll);
  }
  async function warm() {
    const stale = await db
      .select({ id: sources.id })
      .from(sources)
      .where(sql`${sources.refreshAt}<now() and ${sources.fetchedAt}>now()-interval '7 days'`)
      .limit(8);
    for (const row of stale) await hydrate(row.id, 1000);
  }
  return {
    enqueue,
    hydrate,
    tick,
    warm,
    start() {
      started = true;
      void background(tick);
    },
    settled,
    settledJob,
    kick,
    stop() {
      stopped = true;
      abort.abort();
      if (timer) clearTimeout(timer);
      clearTimeout(delayedWake);
      for (const id of waiters.keys()) finished(id);
    },
    runJob,
  };
}
export type Sync = ReturnType<typeof createSync>;
